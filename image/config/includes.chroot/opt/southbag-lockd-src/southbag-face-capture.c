/*
 * southbag-face-capture PHOTO.JPG - capture one frame from the kiosk
 * camera into a JPEG file for southbag-face-unlock.
 *
 * v4l2 mmap capture: prefers the camera's own MJPEG (many UVC cameras
 * emit JPEG directly), falls back to YUYV converted through libjpeg.
 * Grabs several frames and keeps the last so auto-exposure settles.
 * The output file is created by the caller (0600, tmpfs) and truncated
 * here; nothing is logged. Exit 0 = a photo was written, anything else
 * means no photo.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/videodev2.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <unistd.h>
#include <jpeglib.h>

#define WIDTH 640
#define HEIGHT 480
#define FRAMES 6

static int xioctl(int fd, unsigned long req, void *arg) {
	int r;
	do { r = ioctl(fd, req, arg); } while (r < 0 && errno == EINTR);
	return r;
}

static void write_jpeg(const char *path, unsigned char *rgb, int w, int h) {
	FILE *f = fopen(path, "wb");
	if (!f)
		_exit(2);
	struct jpeg_compress_struct cinfo;
	struct jpeg_error_mgr jerr;
	cinfo.err = jpeg_std_error(&jerr);
	jpeg_create_compress(&cinfo);
	jpeg_stdio_dest(&cinfo, f);
	cinfo.image_width = w;
	cinfo.image_height = h;
	cinfo.input_components = 3;
	cinfo.in_color_space = JCS_RGB;
	jpeg_set_defaults(&cinfo);
	jpeg_set_quality(&cinfo, 85, TRUE);
	jpeg_start_compress(&cinfo, TRUE);
	while (cinfo.next_scanline < cinfo.image_height) {
		JSAMPROW row = rgb + cinfo.next_scanline * w * 3;
		jpeg_write_scanlines(&cinfo, &row, 1);
	}
	jpeg_finish_compress(&cinfo);
	jpeg_destroy_compress(&cinfo);
	fclose(f);
}

int main(int argc, char **argv) {
	if (argc != 2)
		return 2;
	const char *out = argv[1];
	const char *dev = getenv("SOUTHBAG_CAMERA");
	if (!dev)
		dev = "/dev/video0";

	int fd = open(dev, O_RDWR | O_CLOEXEC);
	if (fd < 0)
		return 3;

	struct v4l2_format fmt = {0};
	fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
	fmt.fmt.pix.width = WIDTH;
	fmt.fmt.pix.height = HEIGHT;
	fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_MJPEG;
	fmt.fmt.pix.field = V4L2_FIELD_ANY;
	if (xioctl(fd, VIDIOC_S_FMT, &fmt) < 0 || fmt.fmt.pix.pixelformat != V4L2_PIX_FMT_MJPEG) {
		fmt.fmt.pix.pixelformat = V4L2_PIX_FMT_YUYV;
		if (xioctl(fd, VIDIOC_S_FMT, &fmt) < 0) { close(fd); return 4; }
	}
	int is_mjpeg = fmt.fmt.pix.pixelformat == V4L2_PIX_FMT_MJPEG;
	int w = fmt.fmt.pix.width, h = fmt.fmt.pix.height;

	struct v4l2_requestbuffers req = {0};
	req.count = 2;
	req.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
	req.memory = V4L2_MEMORY_MMAP;
	if (xioctl(fd, VIDIOC_REQBUFS, &req) < 0) { close(fd); return 5; }

	void *buf[2] = {0};
	for (unsigned i = 0; i < req.count && i < 2; i++) {
		struct v4l2_buffer b = {0};
		b.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
		b.memory = V4L2_MEMORY_MMAP;
		b.index = i;
		if (xioctl(fd, VIDIOC_QUERYBUF, &b) < 0) { close(fd); return 6; }
		buf[i] = mmap(NULL, b.length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, b.m.offset);
		if (buf[i] == MAP_FAILED) { close(fd); return 7; }
	}

	for (unsigned i = 0; i < req.count && i < 2; i++) {
		struct v4l2_buffer b = {0};
		b.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
		b.memory = V4L2_MEMORY_MMAP;
		b.index = i;
		if (xioctl(fd, VIDIOC_QBUF, &b) < 0) { close(fd); return 8; }
	}
	enum v4l2_buf_type type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
	if (xioctl(fd, VIDIOC_STREAMON, &type) < 0) { close(fd); return 9; }

	unsigned char *frame = NULL;
	size_t frame_len = 0;
	for (int i = 0; i < FRAMES; i++) {
		fd_set rfds;
		FD_ZERO(&rfds);
		FD_SET(fd, &rfds);
		struct timeval tv = { .tv_sec = 2, .tv_usec = 0 };
		if (select(fd + 1, &rfds, NULL, NULL, &tv) <= 0) { close(fd); return 10; }
		struct v4l2_buffer b = {0};
		b.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
		b.memory = V4L2_MEMORY_MMAP;
		if (xioctl(fd, VIDIOC_DQBUF, &b) < 0) { close(fd); return 11; }
		if (i == FRAMES - 1) {
			frame = buf[b.index];
			frame_len = b.bytesused;
		}
		if (i < FRAMES - 1)
			xioctl(fd, VIDIOC_QBUF, &b);
	}
	xioctl(fd, VIDIOC_STREAMOFF, &type);

	if (!frame || frame_len == 0) { close(fd); return 12; }
	if (is_mjpeg) {
		FILE *f = fopen(out, "wb");
		if (!f) { close(fd); return 13; }
		fwrite(frame, 1, frame_len, f);
		fclose(f);
	} else {
		unsigned char *rgb = malloc((size_t)w * h * 3);
		if (!rgb) { close(fd); return 14; }
		for (int i = 0; i < w * h; i++) {
			int y = frame[2 * i];
			int u = frame[4 * (i / 2) + 1] - 128;
			int v = frame[4 * (i / 2) + 3] - 128;
			int r = y + ((359 * v) >> 8);
			int g = y - ((88 * u + 183 * v) >> 8);
			int b = y + ((454 * u) >> 8);
			rgb[3 * i] = r < 0 ? 0 : r > 255 ? 255 : r;
			rgb[3 * i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
			rgb[3 * i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
		}
		write_jpeg(out, rgb, w, h);
		free(rgb);
	}
	close(fd);
	return 0;
}
