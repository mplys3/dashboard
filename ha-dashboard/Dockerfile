FROM node:20-alpine

WORKDIR /app

ARG BUILD_VERSION

RUN echo "Building dashboard ${BUILD_VERSION}" \
  && apk add --no-cache git \
  && git clone --depth 1 https://github.com/mplys3/dashboard.git /tmp/dashboard \
  && cp /tmp/dashboard/package.json ./ \
  && npm install --omit=dev \
  && cp -r /tmp/dashboard/app ./app \
  && cp /tmp/dashboard/server.js ./ \
  && rm -rf /tmp/dashboard

COPY run.sh /run.sh
RUN chmod a+x /run.sh

ENV PORT=80
EXPOSE 80

CMD ["/run.sh"]
