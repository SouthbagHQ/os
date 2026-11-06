#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>
#include <pwd.h>
#include <signal.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef BROKER_PATH
#define BROKER_PATH "/usr/local/sbin/southbag-input-broker"
#endif
#ifndef SOCKET_PATH
#define SOCKET_PATH "/run/southbag-input-broker.sock"
#endif
#ifdef SB_TEST
#define ROOT_UID getuid()
#else
#define ROOT_UID 0
#endif
static volatile sig_atomic_t child_pid;
static void timeout_exit(int sig) {
 (void)sig;
 if (child_pid > 0) kill(-child_pid, SIGKILL);
 _exit(1);
}
static void bounded(unsigned seconds) {
 struct sigaction sa = {.sa_handler=timeout_exit};
 sigemptyset(&sa.sa_mask); sigaction(SIGALRM,&sa,NULL);
 signal(SIGPIPE,SIG_IGN); alarm(seconds);
}
static int send_all(int fd,const char *s) {
 size_t n=strlen(s);
 while(n) { ssize_t k=write(fd,s,n); if(k<0 && errno==EINTR)continue; if(k<=0)return -1; s+=k;n-=k; }
 return 0;
}
/* One bounded line AND EOF. Trailing bytes, truncation and embedded NUL fail. */
static int read_line(int fd,char *buf,size_t cap) {
 size_t n=0; char c;
 for(;;) {
  ssize_t k=read(fd,&c,1); if(k<0 && errno==EINTR)continue;
  if(k<0)return -1;
  if(!k)break;
  if(n+1>=cap || !c)return -1;
  buf[n++]=c;
 }
 if(!n || buf[n-1]!='\n')return -1;
 buf[n]=0; return 0;
}
static int decimal(const char *s,int positive) {
 size_t n=strlen(s);
 if(!n || n>18 || (n>1 && s[0]=='0') || (positive && s[0]=='0'))return 0;
 for(size_t i=0;i<n;i++)if(s[i]<'0'||s[i]>'9')return 0;
 return 1;
}
static int current_reply(const char *s) {
 const char *prefix="generation="; size_t k=strlen(prefix);
 if(strncmp(s,prefix,k))return 0;
 const char *p=strchr(s+k,' '); if(!p || p-s-(int)k>18)return 0;
 char g[20];memcpy(g,s+k,(size_t)(p-s-k));g[p-s-k]=0;
 if(!decimal(g,0))return 0;
 return !strcmp(p," state=inhibited\n") || !strcmp(p," state=failed\n") || !strcmp(p," state=stopping\n");
}
static int peer(int fd,uid_t *uid) {
 struct ucred cred; socklen_t n=sizeof cred;
 if(getsockopt(fd,SOL_SOCKET,SO_PEERCRED,&cred,&n) || n!=sizeof cred)return -1;
 *uid=cred.uid;return 0;
}
static int serve(void) {
 uid_t uid; struct passwd *pw;
 if(geteuid()!=ROOT_UID || peer(0,&uid))return 1;
 pw=getpwnam("customer");
 if(uid!=ROOT_UID && (!pw || uid!=pw->pw_uid))return 1;
 bounded(8);
 char req[64]; if(read_line(0,req,sizeof req))return 1;
 int inhibit=0; char *gen=NULL;
 if(strcmp(req,"current\n")) {
  if(strncmp(req,"inhibit ",8))return 1;
  inhibit=1;gen=req+8;gen[strlen(gen)-1]=0;
  if(!decimal(gen,1))return 1;
 }
 bounded(40);
 int p[2];if(pipe2(p,O_CLOEXEC))return 1;
 pid_t pid=fork();if(pid<0){close(p[0]);close(p[1]);return 1;}
 if(!pid) {
  setpgid(0,0); close(p[0]);
  int null=open("/dev/null",O_RDWR);if(null<0)_exit(1);
  if(dup2(null,0)<0 || dup2(p[1],1)<0 || dup2(null,2)<0)_exit(1);
  close(null);close(p[1]);
  char *const env[]={"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin","LANG=C",NULL};
  if(inhibit)execle("/bin/sh","sh",BROKER_PATH,"inhibit",gen,(char*)NULL,env);
  else execle("/bin/sh","sh",BROKER_PATH,"current",(char*)NULL,env);
  _exit(1);
 }
 child_pid=pid;setpgid(pid,pid);close(p[1]);
 char out[128]; size_t n=0; int bad=0;
 for(;;) {
  ssize_t k=read(p[0],out+n,sizeof out-1-n);
  if(k<0 && errno==EINTR)continue;
  if(k<0){bad=1;break;} if(!k)break;
  n+=(size_t)k; if(n==sizeof out-1){bad=1;kill(-pid,SIGKILL);break;}
 }
 close(p[0]);out[n]=0;int st;
 while(waitpid(pid,&st,0)<0){if(errno!=EINTR)return 1;}
 child_pid=0;
 if(bad || !WIFEXITED(st) || WEXITSTATUS(st) || memchr(out,0,n))return 1;
 if(inhibit) {if(n)return 1;return send_all(0,"OK\n")!=0;}
 if(!current_reply(out))return 1;
 return send_all(0,out)!=0;
}
int main(int argc,char **argv) {
 if(argc==2 && !strcmp(argv[1],"--serve"))return serve();
 char req[64];int inhibit=0;
 if(argc==2 && !strcmp(argv[1],"current"))strcpy(req,"current\n");
 else if(argc==3 && !strcmp(argv[1],"inhibit") && decimal(argv[2],1)) {
  inhibit=1;snprintf(req,sizeof req,"inhibit %s\n",argv[2]);
 } else return 2;
 bounded(50);
 int fd=socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC,0);if(fd<0)return 1;
 struct sockaddr_un addr={.sun_family=AF_UNIX};
 if(strlen(SOCKET_PATH)>=sizeof addr.sun_path)return 1;
 strcpy(addr.sun_path,SOCKET_PATH);
 uid_t uid;
 if(connect(fd,(struct sockaddr*)&addr,sizeof addr) || peer(fd,&uid) || uid!=ROOT_UID)return 1;
 if(send_all(fd,req) || shutdown(fd,SHUT_WR))return 1;
 char out[128];if(read_line(fd,out,sizeof out))return 1;close(fd);
 if(inhibit)return strcmp(out,"OK\n")!=0;
 if(!current_reply(out))return 1;
 return fputs(out,stdout)<0;
}
