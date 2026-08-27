FROM nginx:alpine
COPY public/index.html public/app.js public/styles.css public/dispatch.css /usr/share/nginx/html/
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
