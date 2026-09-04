# Specify the base Docker image. You can read more about
# the available images at https://crawlee.dev/docs/guides/docker-images
# You can also use any other image from Docker Hub.
FROM apify/actor-node:24

# Copy just package.json and package-lock.json
# to speed up the build using Docker layer cache.
COPY --chown=myuser:myuser package*.json Dockerfile ./

# Install NPM packages, skipping only development dependencies to keep the
# image small. Do NOT use --omit=optional here: impit ships its Rust native
# binary via napi-rs optionalDependencies, which --omit=optional would skip.
RUN npm --quiet set progress=false \
    && npm ci --omit=dev --include=optional --no-audit --no-fund --legacy-peer-deps \
    && node -e "import('impit').then(m => console.log('impit OK:', Object.keys(m)))" \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && rm -r ~/.npm

# Next, copy the remaining files and directories with the source code.
# Since we do this after NPM install, quick build will be really fast
# for most source file changes.
COPY --chown=myuser:myuser . ./

CMD ["node", "src/main.js"]
