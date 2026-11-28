#!/bin/bash
SRC=${SRC:-/home/claude/sgfd-app}
cd /home/claude/testrun/app && cp ${SRC}/.env.example . && rm -rf src server db scripts && cp -r ${SRC}/src ${SRC}/server ${SRC}/db ${SRC}/scripts . && mkdir -p public && rm -rf public/brand-sandbox public/brand-fenmorix && cp -r ${SRC}/public/brand-fenmorix public/ && cp ${SRC}/public/sw.js dist/ && \
NODE_PATH=/opt/npm-tools/node_modules /opt/npm-tools/node_modules/.bin/esbuild src/main.jsx --bundle --outfile=dist/app.js --loader:.js=jsx --jsx=automatic --define:process.env.NODE_ENV='"production"' --alias:lucide-react=/home/claude/testrun/stubs/lucide-real.js --alias:recharts=/home/claude/testrun/stubs/recharts.js --alias:papaparse=/home/claude/testrun/stubs/papaparse.js --log-level=warning
# Same robots meta as the real index.html (search engines never index app servers)
grep -q 'name="robots"' /home/claude/testrun/app/dist/index.html || sed -i 's#<meta charset="UTF-8" />#&\n    <meta name="robots" content="noindex, nofollow" />#' /home/claude/testrun/app/dist/index.html
# The signed-out page's own bundle (production: vite's second input, signin.html)
cd /home/claude/testrun/app && cp ${SRC}/public/logo-large.png dist/ && \
NODE_PATH=/opt/npm-tools/node_modules /opt/npm-tools/node_modules/.bin/esbuild src/signedOut.jsx --bundle --outfile=dist/signin.js --loader:.js=jsx --jsx=automatic --define:process.env.NODE_ENV='"production"' --log-level=warning && \
sed 's#<script src="/app.js"></script>#<script src="/signin.js"></script>#' dist/index.html > dist/signin.html
# The client portal's own bundle (production: vite's third input, portal.html)
cd /home/claude/testrun/app && \
NODE_PATH=/opt/npm-tools/node_modules /opt/npm-tools/node_modules/.bin/esbuild src/portal/main.jsx --bundle --outfile=dist/portal.js --loader:.js=jsx --jsx=automatic --define:process.env.NODE_ENV='"production"' --alias:lucide-react=/home/claude/testrun/stubs/lucide-real.js --log-level=warning && \
sed 's#<script src="/app.js"></script>#<script src="/portal.js"></script>#; s#<title>[^<]*</title>#<title>Fenmorix Client Portal</title>#' dist/index.html > dist/portal.html
# The gradebook family page's own bundle (production: vite's fourth input, grades.html)
cd /home/claude/testrun/app && \
NODE_PATH=/opt/npm-tools/node_modules /opt/npm-tools/node_modules/.bin/esbuild src/family/main.jsx --bundle --outfile=dist/grades.js --loader:.js=jsx --jsx=automatic --define:process.env.NODE_ENV='"production"' --alias:lucide-react=/home/claude/testrun/stubs/lucide-real.js --log-level=warning && \
sed 's#<script src="/app.js"></script>#<script src="/grades.js"></script>#; s#<title>[^<]*</title>#<title>Grades</title>#' dist/index.html > dist/grades.html
