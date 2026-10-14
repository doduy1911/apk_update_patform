FROM node:22.23.3-bookworm-slim AS base
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM base AS production-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runtime
ENV NODE_ENV=production
ENV ANDROID_SDK_ROOT=/opt/android-sdk
ENV PATH="/opt/android-sdk/cmdline-tools/latest/bin:/opt/android-sdk/build-tools/35.0.0:${PATH}"
ARG ANDROID_CMDLINE_TOOLS_REVISION=15859902
ARG ANDROID_CMDLINE_TOOLS_SHA256=4e4c464f145a7512b57d088ac6c278c03c9eea610886b35a5e0804e74eedf583
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openjdk-17-jre-headless unzip wget \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p "$ANDROID_SDK_ROOT/cmdline-tools" /tmp/android-sdk \
    && wget -q "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_CMDLINE_TOOLS_REVISION}_latest.zip" -O /tmp/android-tools.zip \
    && echo "$ANDROID_CMDLINE_TOOLS_SHA256  /tmp/android-tools.zip" | sha256sum -c - \
    && unzip -q /tmp/android-tools.zip -d /tmp/android-sdk \
    && mv /tmp/android-sdk/cmdline-tools "$ANDROID_SDK_ROOT/cmdline-tools/latest" \
    && yes | "$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_SDK_ROOT" --licenses >/dev/null \
    && "$ANDROID_SDK_ROOT/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_SDK_ROOT" "platforms;android-35" "build-tools;35.0.0" >/dev/null \
    && rm -rf /tmp/android-tools.zip /tmp/android-sdk "$ANDROID_SDK_ROOT/.temp"
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /data/apks/.staging && chown -R node:node /data/apks
USER node
EXPOSE 3000
CMD ["npm", "start"]
