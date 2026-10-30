# Kuhi (anime resolver) image, built and tagged `kuhi:current` by release-vps / by hand:
#   docker build -t kuhi:current scripts/vps/kuhi/
# Runs on the private `shasta` docker network so the backend reaches it as http://kuhi:8090
# (KUHI_URL in /etc/shasta/shasta.env) — never published to the internet. See scripts/vps/kuhi.md.
FROM python:3.12-slim

RUN apt-get update \
	&& apt-get install -y --no-install-recommends git \
	&& rm -rf /var/lib/apt/lists/*

# Pin the ref on purpose (a branch or tag); bump deliberately, never track `main` blindly.
ARG KUHI_REF=main
RUN git clone --depth 1 --branch "${KUHI_REF}" https://github.com/aryaniiil/anime-api /app

WORKDIR /app
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8090
# loopback inside the network only; the backend is the sole caller
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8090"]
