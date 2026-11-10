#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/time.h>
#include <unistd.h>
#include <stdio.h>
#include <string.h>
#include <errno.h>
/* Nonsecret disposable guest test helper, never installed in product. */
int main(int argc,char **argv) {
 if(argc!=2)return 2;
 unsigned char b[2048];size_t n=strlen(argv[1]);if(n%2||n/2>sizeof b)return 2;
 for(size_t i=0;i<n/2;i++){unsigned x;if(sscanf(argv[1]+2*i,"%2x",&x)!=1)return 2;b[i]=(unsigned char)x;}
 int fd=socket(AF_UNIX,SOCK_STREAM,0);if(fd<0)return 2;
 struct sockaddr_un a={.sun_family=AF_UNIX};strcpy(a.sun_path,"/run/southbag-input-broker.sock");
 struct timeval t={.tv_sec=12};setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&t,sizeof t);
 if(connect(fd,(struct sockaddr*)&a,sizeof a))return 2;
 if(write(fd,b,n/2)!=(ssize_t)(n/2))return 2;
 shutdown(fd,SHUT_WR);
 ssize_t k=read(fd,b,sizeof b);close(fd);
 if(k<0 && errno!=ECONNRESET)return 2;
 printf("reply_bytes=%zd\n",k>0?k:0);return k>0?1:0;
}
