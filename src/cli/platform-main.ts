#!/usr/bin/env node

import { reportCliFailure, runCli } from "./main.js";

void runCli(process.argv.slice(2), {
  surface: "platform",
  launcherName: "themis-platform",
}).catch(reportCliFailure);
