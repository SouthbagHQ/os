/*
 * southbag-lockd - the Southbag OS lock screen client.
 *
 * Owns the session through ext-session-lock-v1: the compositor hides every
 * window until we unlock, so this is the door, not a page pretending to
 * cover the shell. One surface per output, including outputs hotplugged
 * while locked. Passwords go to /usr/local/bin/southbag-unlock on stdin;
 * face attempts go through southbag-face-capture + southbag-face-unlock.
 * The helpers do the online verify and clear the locked flag; any helper
 * failure, crash or oddity leaves the session locked. Until this client is
 * proven on-device, southbag-lock keeps swaylock as the default and this
 * binary sits dark behind /etc/southbag-lockd.
 *
 * Input is wl_keyboard only. There is no mouse handling: a kiosk lock has
 * nothing to click. Secrets live in a heap buffer, are zeroed before every
 * free, and never touch argv, environment or logs.
 */
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <wayland-client.h>
#include <xkbcommon/xkbcommon.h>
#include <cairo.h>
#include "ext-session-lock-v1.h"

#define MAXPW 128

struct output {
	struct wl_output *output;
	uint32_t reg_name;
	struct wl_surface *surface;
	struct ext_session_lock_surface_v1 *lock_surface;
	struct wl_buffer *buffer;
	uint32_t *pixels;
	int w, h, configured;
	struct output *next;
};

static struct wl_display *display;
static struct wl_compositor *compositor;
static struct wl_shm *shm;
static struct ext_session_lock_manager_v1 *lock_manager;
static struct ext_session_lock_v1 *lock;
static struct wl_seat *seat;
static struct wl_keyboard *keyboard;
static struct xkb_context *xkb;
static struct xkb_keymap *keymap;
static struct xkb_state *xkbstate;

static struct output *outputs;
static int locked;              /* compositor confirmed the session lock */
static int running = 1;
static int unlock_sent;         /* we asked to unlock: finished is expected */

static char password[MAXPW + 1];
static int password_len;
static char status[96];         /* short user-facing line, no secrets */
static pid_t helper_pid = -1;
static int helper_stage;        /* 0 none, 1 password, 2 face capture, 3 face verify */
static char face_photo[] = "/dev/shm/southbag-face-XXXXXX";

static const char *state_dir(void) {
	static char buf[512];
	const char *home = getenv("HOME");
	snprintf(buf, sizeof buf, "%s/.local/share/southbag", home ? home : "/home/customer");
	return buf;
}

static int face_available(void) {
	char p[600];
	snprintf(p, sizeof p, "%s/faceid", state_dir());
	return access(p, R_OK) == 0;
}

static int totp_pending(void) {
	char p[600];
	snprintf(p, sizeof p, "%s/twofa-cookie", state_dir());
	return access(p, R_OK) == 0;
}

/* --- rendering ------------------------------------------------------ */

static void draw(struct output *o) {
	if (!o->pixels || !o->configured)
		return;
	cairo_surface_t *cs = cairo_image_surface_create_for_data(
		(unsigned char *)o->pixels, CAIRO_FORMAT_ARGB32, o->w, o->h, o->w * 4);
	cairo_t *cr = cairo_create(cs);
	cairo_set_source_rgb(cr, 0.020, 0.024, 0.031);
	cairo_paint(cr);

	cairo_select_font_face(cr, "DejaVu Sans", CAIRO_FONT_SLANT_NORMAL, CAIRO_FONT_WEIGHT_NORMAL);
	cairo_set_source_rgb(cr, 0.91, 0.90, 0.87);
	cairo_set_font_size(cr, 22);

	char prompt[160];
	if (helper_stage == 1)
		snprintf(prompt, sizeof prompt, "Checking...");
	else if (helper_stage == 2 || helper_stage == 3)
		snprintf(prompt, sizeof prompt, "Look at the camera...");
	else if (totp_pending())
		snprintf(prompt, sizeof prompt, "Authenticator code");
	else
		snprintf(prompt, sizeof prompt, "Southbag password");

	cairo_text_extents_t ext;
	cairo_text_extents(cr, prompt, &ext);
	cairo_move_to(cr, (o->w - ext.width) / 2, o->h / 2 - 60);
	cairo_show_text(cr, prompt);

	char dots[MAXPW + 1];
	int n = password_len < MAXPW ? password_len : MAXPW;
	for (int i = 0; i < n; i++)
		dots[i] = '*';
	dots[n] = 0;
	cairo_set_font_size(cr, 28);
	cairo_text_extents(cr, dots, &ext);
	cairo_move_to(cr, (o->w - ext.width) / 2, o->h / 2);
	cairo_show_text(cr, dots);

	cairo_set_font_size(cr, 15);
	cairo_set_source_rgb(cr, 0.55, 0.58, 0.65);
	cairo_text_extents(cr, status, &ext);
	cairo_move_to(cr, (o->w - ext.width) / 2, o->h / 2 + 44);
	cairo_show_text(cr, status);

	if (face_available() && helper_stage == 0) {
		const char *hint = "Tab: unlock with face";
		cairo_text_extents(cr, hint, &ext);
		cairo_move_to(cr, (o->w - ext.width) / 2, o->h / 2 + 76);
		cairo_show_text(cr, hint);
	}

	cairo_destroy(cr);
	cairo_surface_destroy(cs);
	wl_surface_damage(o->surface, 0, 0, o->w, o->h);
}

static void draw_all(void) {
	for (struct output *o = outputs; o; o = o->next)
		draw(o);
}

static int make_buffer(struct output *o, int w, int h) {
	int stride = w * 4, size = stride * h;
	char name[] = "/southbag-lockd-XXXXXX";
	int fd = shm_open(name, O_RDWR | O_CREAT | O_EXCL, 0600);
	if (fd < 0)
		return -1;
	shm_unlink(name);
	if (ftruncate(fd, size) < 0) { close(fd); return -1; }
	void *data = mmap(NULL, size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
	if (data == MAP_FAILED) { close(fd); return -1; }
	struct wl_shm_pool *pool = wl_shm_create_pool(shm, fd, size);
	o->buffer = wl_shm_pool_create_buffer(pool, 0, w, h, stride, WL_SHM_FORMAT_XRGB8888);
	wl_shm_pool_destroy(pool);
	close(fd);
	free(o->pixels);
	o->pixels = data;
	o->w = w; o->h = h;
	return 0;
}

static void free_buffer(struct output *o) {
	if (o->buffer) wl_buffer_destroy(o->buffer);
	o->buffer = NULL;
	if (o->pixels) munmap(o->pixels, o->w * o->h * 4);
	o->pixels = NULL;
}

/* --- session lock surface ------------------------------------------- */

static void lsurface_configure(void *data, struct ext_session_lock_surface_v1 *s,
		uint32_t serial, uint32_t w, uint32_t h) {
	struct output *o = data;
	ext_session_lock_surface_v1_ack_configure(s, serial);
	if (w == 0 || h == 0) { w = 1024; h = 768; }
	if (!o->pixels || o->w != (int)w || o->h != (int)h) {
		free_buffer(o);
		if (make_buffer(o, w, h) < 0)
			return;
	}
	o->configured = 1;
	draw(o);
	wl_surface_attach(o->surface, o->buffer, 0, 0);
	wl_surface_commit(o->surface);
}

static const struct ext_session_lock_surface_v1_listener lsurface_listener = {
	.configure = lsurface_configure,
};

static void add_surface(struct output *o) {
	if (o->lock_surface || !lock)
		return;
	o->surface = wl_compositor_create_surface(compositor);
	o->lock_surface = ext_session_lock_v1_get_lock_surface(lock, o->surface, o->output);
	ext_session_lock_surface_v1_add_listener(o->lock_surface, &lsurface_listener, o);
	/* No commit here: committing a session lock surface before the first
	 * configure, with no buffer attached, is a null_buffer protocol error.
	 * The compositor sends configure on role assignment; the first commit
	 * happens in the configure handler after ack + attach. */
}

static void drop_surface(struct output *o) {
	if (o->lock_surface) ext_session_lock_surface_v1_destroy(o->lock_surface);
	o->lock_surface = NULL;
	if (o->surface) wl_surface_destroy(o->surface);
	o->surface = NULL;
	free_buffer(o);
	o->configured = 0;
}

/* --- session lock ----------------------------------------------------- */

static void lock_locked(void *data, struct ext_session_lock_v1 *l) {
	(void)data; (void)l;
	locked = 1;
	for (struct output *o = outputs; o; o = o->next)
		add_surface(o);
}

static void lock_finished(void *data, struct ext_session_lock_v1 *l) {
	(void)data; (void)l;
	/* The compositor tore the lock down without our unlock (e.g. it is
	 * dying). The locked flag still stands; southbag-shell re-engages a
	 * lock before showing anything. Exit so that restart happens now. */
	if (!unlock_sent)
		exit(1);
	running = 0;
}

static const struct ext_session_lock_v1_listener lock_listener = {
	.locked = lock_locked,
	.finished = lock_finished,
};

/* --- helpers ---------------------------------------------------------- */

static void set_status(const char *s) {
	snprintf(status, sizeof status, "%s", s);
	draw_all();
}

static void clear_password(void) {
	memset(password, 0, sizeof password);
	password_len = 0;
}

static void spawn_password_verify(void) {
	if (helper_pid > 0 || password_len == 0)
		return;
	int fds[2];
	if (pipe(fds) < 0) { set_status("Try again"); return; }
	pid_t pid = fork();
	if (pid < 0) { close(fds[0]); close(fds[1]); set_status("Try again"); return; }
	if (pid == 0) {
		dup2(fds[0], 0);
		close(fds[0]); close(fds[1]);
		execl("/usr/local/bin/southbag-unlock", "southbag-unlock", (char *)NULL);
		_exit(127);
	}
	close(fds[0]);
	ssize_t wr = write(fds[1], password, password_len);
	(void)wr;
	wr = write(fds[1], "\n", 1);
	(void)wr;
	close(fds[1]);
	clear_password();
	helper_pid = pid;
	helper_stage = 1;
	set_status("");
}

static void spawn_face_attempt(void) {
	if (helper_pid > 0 || !face_available())
		return;
	int fd = mkstemp(face_photo);
	if (fd < 0) { set_status("Camera failed"); return; }
	close(fd);
	pid_t pid = fork();
	if (pid < 0) { unlink(face_photo); set_status("Camera failed"); return; }
	if (pid == 0) {
		execl("/usr/local/bin/southbag-face-capture", "southbag-face-capture",
		      face_photo, (char *)NULL);
		_exit(127);
	}
	helper_pid = pid;
	helper_stage = 2;
	set_status("");
}

static void do_unlock(void) {
	unlock_sent = 1;
	ext_session_lock_v1_unlock_and_destroy(lock);
	wl_display_roundtrip(display);
	running = 0;
}

static void reap_helper(void) {
	if (helper_pid <= 0)
		return;
	int st;
	pid_t r = waitpid(helper_pid, &st, WNOHANG);
	if (r <= 0)
		return;
	int stage = helper_stage;
	helper_pid = -1;
	helper_stage = 0;
	int ok = WIFEXITED(st) && WEXITSTATUS(st) == 0;

	if (stage == 2) { /* capture done -> verify, unless capture failed */
		if (!ok) { set_status("Camera failed"); return; }
		pid_t pid = fork();
		if (pid == 0) {
			execl("/usr/local/bin/southbag-face-unlock", "southbag-face-unlock",
			      face_photo, (char *)NULL);
			_exit(127);
		}
		if (pid < 0) { set_status("Try again"); return; }
		helper_pid = pid;
		helper_stage = 3;
		return;
	}
	if (ok) {
		do_unlock();
		return;
	}
	if (stage == 1)
		set_status(totp_pending() ? "Enter your authenticator code" : "Wrong password");
	else
		set_status("Face did not match");
}

/* --- keyboard ---------------------------------------------------------- */

static void kbd_keymap(void *data, struct wl_keyboard *kb, uint32_t format,
		int32_t fd, uint32_t size) {
	(void)data; (void)kb;
	if (keymap) { xkb_keymap_unref(keymap); keymap = NULL; }
	if (xkbstate) { xkb_state_unref(xkbstate); xkbstate = NULL; }
	if (format == WL_KEYBOARD_KEYMAP_FORMAT_XKB_V1) {
		char *map = mmap(NULL, size, PROT_READ, MAP_PRIVATE, fd, 0);
		if (map != MAP_FAILED) {
			keymap = xkb_keymap_new_from_string(xkb, map,
				XKB_KEYMAP_FORMAT_TEXT_V1, XKB_KEYMAP_COMPILE_NO_FLAGS);
			munmap(map, size);
			if (keymap)
				xkbstate = xkb_state_new(keymap);
		}
	}
	close(fd);
}

static void kbd_key(void *data, struct wl_keyboard *kb, uint32_t serial,
		uint32_t time, uint32_t key, uint32_t state_w) {
	(void)data; (void)kb; (void)serial; (void)time;
	if (state_w != WL_KEYBOARD_KEY_STATE_PRESSED || !xkbstate)
		return;
	if (!locked)
		return; /* no input before the compositor confirms the lock */
	xkb_keysym_t sym = xkb_state_key_get_one_sym(xkbstate, key + 8);
	switch (sym) {
	case XKB_KEY_Return: case XKB_KEY_KP_Enter:
		if (helper_pid < 0)
			spawn_password_verify();
		return;
	case XKB_KEY_Tab:
		if (helper_pid < 0)
			spawn_face_attempt();
		return;
	case XKB_KEY_BackSpace:
		if (password_len > 0)
			password[--password_len] = 0;
		break;
	case XKB_KEY_Escape:
		clear_password();
		break;
	default: {
		if (helper_pid > 0)
			return;
		char buf[16];
		int n = xkb_state_key_get_utf8(xkbstate, key + 8, buf, sizeof buf);
		if (n > 0 && password_len + n <= MAXPW) {
			memcpy(password + password_len, buf, n);
			password_len += n;
			password[password_len] = 0;
		}
		break;
	}
	}
	draw_all();
}

static void kbd_modifiers(void *data, struct wl_keyboard *kb, uint32_t serial,
		uint32_t depressed, uint32_t latched, uint32_t locked_m, uint32_t group) {
	(void)data; (void)kb; (void)serial;
	if (xkbstate)
		xkb_state_update_mask(xkbstate, depressed, latched, locked_m, 0, 0, group);
}

static void kbd_enter(void *d, struct wl_keyboard *k, uint32_t s, struct wl_surface *su,
		struct wl_array *keys) { (void)d; (void)k; (void)s; (void)su; (void)keys; }
static void kbd_leave(void *d, struct wl_keyboard *k, uint32_t s, struct wl_surface *su) {
	(void)d; (void)k; (void)s; (void)su; }
static void kbd_repeat_info(void *d, struct wl_keyboard *k, int32_t rate, int32_t delay) {
	(void)d; (void)k; (void)rate; (void)delay; }

static const struct wl_keyboard_listener kbd_listener = {
	.keymap = kbd_keymap,
	.enter = kbd_enter,
	.leave = kbd_leave,
	.key = kbd_key,
	.modifiers = kbd_modifiers,
	.repeat_info = kbd_repeat_info,
};

static void seat_capabilities(void *data, struct wl_seat *s, uint32_t caps) {
	(void)data;
	if ((caps & WL_SEAT_CAPABILITY_KEYBOARD) && !keyboard) {
		keyboard = wl_seat_get_keyboard(s);
		wl_keyboard_add_listener(keyboard, &kbd_listener, NULL);
	} else if (!(caps & WL_SEAT_CAPABILITY_KEYBOARD) && keyboard) {
		wl_keyboard_destroy(keyboard);
		keyboard = NULL;
	}
}

static void seat_name(void *data, struct wl_seat *s, const char *name) {
	(void)data; (void)s; (void)name;
}

static const struct wl_seat_listener seat_listener = {
	.capabilities = seat_capabilities,
	.name = seat_name,
};

/* --- registry / outputs ------------------------------------------------- */

static void registry_global(void *data, struct wl_registry *registry, uint32_t name,
		const char *interface, uint32_t version) {
	(void)data;
	if (strcmp(interface, wl_compositor_interface.name) == 0)
		compositor = wl_registry_bind(registry, name, &wl_compositor_interface, 4);
	else if (strcmp(interface, wl_shm_interface.name) == 0)
		shm = wl_registry_bind(registry, name, &wl_shm_interface, 1);
	else if (strcmp(interface, wl_seat_interface.name) == 0) {
		seat = wl_registry_bind(registry, name, &wl_seat_interface, 5);
		wl_seat_add_listener(seat, &seat_listener, NULL);
	} else if (strcmp(interface, ext_session_lock_manager_v1_interface.name) == 0)
		lock_manager = wl_registry_bind(registry, name,
			&ext_session_lock_manager_v1_interface, 1);
	else if (strcmp(interface, wl_output_interface.name) == 0) {
		struct wl_output *wo = wl_registry_bind(registry, name,
			&wl_output_interface, version < 4 ? version : 4);
		struct output *o = calloc(1, sizeof *o);
		o->output = wo;
		o->reg_name = name;
		o->next = outputs;
		outputs = o;
		if (locked) /* hotplug while locked: cover it immediately */
			add_surface(o);
	}
	(void)version;
}

static void registry_global_remove(void *data, struct wl_registry *registry, uint32_t name) {
	(void)data; (void)registry;
	/* An output vanished: tear down its lock surface and forget it. Fewer
	 * surfaces never exposes the session - the compositor owns the lock;
	 * this only stops us drawing to a dead output. */
	struct output **link = &outputs;
	while (*link) {
		struct output *o = *link;
		if (o->reg_name == name) {
			drop_surface(o);
			if (o->output)
				wl_output_release(o->output);
			*link = o->next;
			free(o);
			return;
		}
		link = &o->next;
	}
}

static const struct wl_registry_listener registry_listener = {
	.global = registry_global,
	.global_remove = registry_global_remove,
};

int main(void) {
	setvbuf(stdout, NULL, _IONBF, 0);
	display = wl_display_connect(NULL);
	if (!display) {
		fprintf(stderr, "southbag-lockd: no wayland display\n");
		return 1;
	}
	xkb = xkb_context_new(XKB_CONTEXT_NO_FLAGS);
	struct wl_registry *registry = wl_display_get_registry(display);
	wl_registry_add_listener(registry, &registry_listener, NULL);
	wl_display_roundtrip(display);

	if (!compositor || !shm || !lock_manager) {
		fprintf(stderr, "southbag-lockd: compositor lacks ext-session-lock\n");
		return 1;
	}
	lock = ext_session_lock_manager_v1_lock(lock_manager);
	ext_session_lock_v1_add_listener(lock, &lock_listener, NULL);

	int fd = wl_display_get_fd(display);
	while (running) {
		while (wl_display_prepare_read(display) != 0)
			wl_display_dispatch_pending(display);
		wl_display_flush(display);
		struct pollfd pfd = { .fd = fd, .events = POLLIN };
		int pr = poll(&pfd, 1, 100);
		if (pr > 0 && (pfd.revents & POLLIN))
			wl_display_read_events(display);
		else {
			wl_display_cancel_read(display);
			if (pr < 0 && errno != EINTR)
				break;
		}
		wl_display_dispatch_pending(display);
		reap_helper();
	}
	clear_password();
	return 0;
}
