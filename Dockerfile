FROM nginx:alpine

COPY index.html app.js styles.css /usr/share/nginx/html/
COPY data/ /usr/share/nginx/html/data/

EXPOSE 80
