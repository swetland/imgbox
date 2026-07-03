
### ImgBox

This is a hobby project, very much a work in progress, and very incomplete.

It is not ready (or safe!) for use on an Internet accessible machine.

It expects to run the mediainfo, ffmpeg, and imagemagick binaries to process
imported/uploaded images and video and does not (yet) use any kind of isolation
when executing them.


### nginx config snippet

Let nginx directly serve the image/video data, but pass everything else
to the node server:

```
  location /imgbox/media/ {
    alias /path/to/imgbox/data/media/;
    autoindex off;
    expires 1w;
    add_header Cache-Control "private, immutable";
  }
  location /imgbox/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
```
