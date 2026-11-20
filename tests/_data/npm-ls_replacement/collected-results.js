#!/usr/bin/env node

/*!
This file is part of CycloneDX generator for NPM projects.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
Copyright (c) OWASP Foundation. All Rights Reserved.
*/

const { createReadStream } = require('node:fs')
const { join } = require('node:path')

if (process.argv[2] === '--version') {
  process.stdout.write(`${process.env.CT_VERSION}\n`)
  process.exit(0)
}

process.exitCode = Number(process.env.CT_EXIT_CODE || 0)

// serve the prepared collected npm-ls data selected by CT_SUBJECT
const resultsFile = join(__dirname, '..', 'npm-ls_credentials', `${process.env.CT_SUBJECT}.json`)

const rs = createReadStream(resultsFile)
rs.once('error', e => { throw e })
rs.once('open', () => { rs.pipe(process.stdout) })
rs.once('end', () => { rs.unpipe(); rs.close() })
