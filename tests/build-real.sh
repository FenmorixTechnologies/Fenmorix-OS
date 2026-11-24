#!/bin/bash
cd /home/claude/testrun/app && cp -r /home/claude/sgfd-app/src /home/claude/sgfd-app/server /home/claude/sgfd-app/db . && \
NODE_PATH=/opt/npm-tools/node_modules /opt/npm-tools/node_modules/.bin/esbuild src/main.jsx --bundle --outfile=dist/app.js --loader:.js=jsx --jsx=automatic --define:process.env.NODE_ENV='"production"' --alias:lucide-react=/home/claude/testrun/stubs/lucide-real.js --alias:recharts=/home/claude/testrun/stubs/recharts.js --alias:papaparse=/home/claude/testrun/stubs/papaparse.js --log-level=warning
