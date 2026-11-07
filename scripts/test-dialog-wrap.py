#!/usr/bin/env python3
"""Compile the exact embedded wrapper with ASan/UBSan and Cairo metrics."""
import os, pathlib, re, shlex, subprocess, tempfile
root = pathlib.Path(__file__).resolve().parents[1]
patch = (root/'image/config/includes.chroot/opt/cog-dialog.patch').read_text()
src = '\n'.join(line[1:] for line in patch.splitlines() if line.startswith('+') and not line.startswith('+++'))
fn = re.search(r'static const char \*\nwrap_message\(.*?\n\}', src, re.S).group()
main = r'''
#include <assert.h>
#include <string.h>
#include <cairo.h>
#include <glib.h>
#define MESSAGE_MAX_LINES 8
#define MESSAGE_TEXT_SIZE 16
#define DIALOG_WIDTH 480
#define DIALOG_PADDING 20
FUNCTION
int main(void) {
 cairo_surface_t *surface=cairo_image_surface_create(CAIRO_FORMAT_ARGB32,1,1);
 cairo_t *cr=cairo_create(surface);
 char lines[8][96]; int n;
 char longtext[2048]; memset(longtext, 'W', sizeof longtext-1); longtext[2047]=0;
 const char *cases[]={"", "hello", "1\n2\n3\n4\n5\n6\n7\n8\n9", longtext,
 "WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW",
 "é漢字é漢字é漢字é漢字é漢字é漢字é漢字é漢字é漢字é漢字é漢字é漢字é漢字é漢字é漢字é漢字"};
 for(unsigned i=0;i<sizeof(cases)/sizeof(cases[0]);i++) {
   const char *cursor=cases[i]; unsigned pages=0;
   GString *got=g_string_new("");
   do {
   memset(lines,0xa5,sizeof lines);
   const char *next=wrap_message(cr,cursor,lines,&n);
   assert(n>=1 && n<=8);
   for(int j=0;j<n;j++) {
     assert(memchr(lines[j],0,96)); assert(g_utf8_validate(lines[j],-1,NULL));
     cairo_text_extents_t ext; cairo_text_extents(cr,lines[j],&ext);
     assert(ext.x_advance<=DIALOG_WIDTH-2*DIALOG_PADDING);
     g_string_append(got,lines[j]);
   }
   pages++; assert(pages<100);
   if(!*next) break;
   assert(next>cursor); cursor=next;
   } while(1);
   GString *expected=g_string_new("");
   for(const char *q=cases[i];*q;q++) if(*q!='\n')g_string_append_c(expected,*q);
   assert(strcmp(got->str,expected->str)==0);
   if(i==2 || i==3) assert(pages>1);
   g_string_free(got,TRUE);g_string_free(expected,TRUE);
 }
 cairo_destroy(cr);cairo_surface_destroy(surface);
 return 0;
}
'''.replace('FUNCTION', fn)
flags=shlex.split(subprocess.check_output(['pkg-config','--cflags','--libs','cairo','glib-2.0'],text=True))
with tempfile.TemporaryDirectory() as d:
 p=pathlib.Path(d); (p/'test.c').write_text(main)
 subprocess.run(['cc','-g','-O0','-fsanitize=address,undefined','-fno-omit-frame-pointer',str(p/'test.c'),'-o',str(p/'test'),*flags],check=True)
 # Fontconfig process-global caches are outside the wrapper's ownership.
 env=os.environ.copy();env['ASAN_OPTIONS']='detect_leaks=0'
 subprocess.run([str(p/'test')],env=env,check=True)
print('wrap metrics/bounds/full-page-reconstruction regression PASS: empty, ordinary, overflow, wide glyphs, UTF-8')
