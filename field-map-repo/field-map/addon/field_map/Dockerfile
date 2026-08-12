ARG BUILD_FROM
FROM $BUILD_FROM

RUN apk add --no-cache python3 py3-pip \
 && python3 -m pip install --break-system-packages --no-cache-dir \
      fastapi==0.115.6 "uvicorn[standard]==0.34.0"

COPY rootfs /
RUN chmod a+x /app/run.sh

WORKDIR /app
CMD [ "/app/run.sh" ]
