# The comment server. The build stage runs on the builder's own platform: its
# output (the script bundle and plain JavaScript dependencies) does not depend
# on it, so only the runtime stage targets the cluster.
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
RUN COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
COPY packages packages
RUN pnpm -F visual-comments build
# The server's own dependencies, as plain folders the runtime image can copy.
RUN mkdir /deps && cp package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc /deps/ \
 && mkdir -p /deps/packages/server /deps/packages/client \
 && cp packages/server/package.json /deps/packages/server/ && cp packages/client/package.json /deps/packages/client/ \
 && cd /deps && pnpm install --frozen-lockfile --prod --filter @visual-comments/server --config.node-linker=hoisted

FROM gcr.io/distroless/nodejs24-debian12:nonroot
WORKDIR /app
COPY --from=build /deps/node_modules node_modules
COPY --from=build /src/packages/server/src packages/server/src
COPY --from=build /src/packages/server/package.json packages/server/package.json
# The server reads the limits it shares with the browser from the client's source.
COPY --from=build /src/packages/client/src/lib/shared packages/client/src/lib/shared
COPY --from=build /src/packages/client/dist-widget packages/client/dist-widget
COPY package.json ./
ENV NODE_ENV=production PORT=4400 DATABASE=/data/comments.sqlite SPACES=/config/spaces.json
EXPOSE 4400
CMD ["packages/server/src/main.ts"]
