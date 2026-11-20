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

const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { dirname, join } = require('node:path')

const { describe, expect, test } = require('@jest/globals')

const { index: indexNpmLsDemoData } = require('../_data/npm-ls_demo-results')
const { makeReproducible } = require('../_helper')
const { NPM_LOWEST_SUPPORTED, UPDATE_SNAPSHOTS, demoResultsRoot, dummyProjectsRoot, latestCdxSpecVersion, mkTemp, npmLsReplacement, runCLI } = require('./')

describe('integration.cli.from-collected', () => {
  const cliRunTestTimeout = 15000

  const tmpRoot = mkTemp('cli.from-collected')

  describe('with prepared npm-ls', () => {
    const tmpRootRun = join(tmpRoot, 'with-prepared')
    mkdirSync(tmpRootRun)

    const _allDemoCases = indexNpmLsDemoData()
    const useCases = [
      {
        subject: 'bare',
        args: [],
        demoCases: _allDemoCases
      },
      {
        subject: 'flatten-components',
        args: ['--flatten-components'],
        demoCases: _allDemoCases.filter((c) => {
          if (c.npm !== `${NPM_LOWEST_SUPPORTED[0]}`) { return false }
          if (c.subject === 'juice-shop') { return true }
          if (c.subject === 'bundled-dependencies') { return true }
          return false
        })
      }
    ]

    describe.each(useCases)('$subject', (ud) => {
      mkdirSync(join(tmpRootRun, ud.subject))

      test.each(ud.demoCases)('$subject $args npm$npm node$node $os', async (dd) => {
        const expectedOutSnap = join(demoResultsRoot, ud.subject, `${dd.subject}${dd.args}_npm${dd.npm}_node${dd.node}_${dd.os}.snap.json`)
        const logFileBase = join(tmpRootRun, ud.subject, `${dd.subject}${dd.args}_npm${dd.npm}_node${dd.node}_${dd.os}`)
        const cwd = dummyProjectsRoot

        const { res, outFile, errFile } = runCLI([
          '-vvv',
          '--output-reproducible',
          '--validate',
          // no intention to test all the spec-versions nor all the output-formats - this would be not our scope.
          '--spec-version', `${latestCdxSpecVersion}`,
          // just use json with the latest most feature-rich version.
          '--output-format', 'JSON',
          // prevent file interaction in this synthetic scenario - they would not exist anyway
          '--package-lock-only',
          // case-specific args
          ...ud.args,
          // explicit args
          ...(dd.args === '' ? [] : dd.args.split(' ')),
          '--',
          // just some dummy project
          join('with-lockfile', 'package.json')
        ], logFileBase, cwd, {
          CT_VERSION: `${dd.npm}.99.0`,
          CT_SUBJECT: dd.subject,
          CT_ARGS: dd.args,
          CT_NPM: dd.npm,
          CT_NODE: dd.node,
          CT_OS: dd.os,
          npm_execpath: npmLsReplacement.demoResults
        })

        try {
          await expect(res).resolves.toBe(0)
        } catch (err) {
          process.stderr.write(readFileSync(errFile))
          throw err
        }

        const actualOutput = makeReproducible('json', readFileSync(outFile, 'utf8'))

        if (UPDATE_SNAPSHOTS) {
          mkdirSync(dirname(expectedOutSnap), { recursive: true })
          writeFileSync(expectedOutSnap, actualOutput, 'utf8')
        }

        expect(actualOutput).toEqual(
          readFileSync(expectedOutSnap, 'utf8'),
          `${outFile} should equal ${expectedOutSnap}`
        )
      }, cliRunTestTimeout)
    })
  })

  describe('with prepared npm-ls containing credentials', () => {
    const tmpRootRun = join(tmpRoot, 'with-credentials')
    mkdirSync(tmpRootRun)

    // constructed inputs: tests/_data/npm-ls_credentials/<subject>.json
    // - registry-with-credentials: private registry mirror tarball URL carrying deployment credentials
    // - git-with-credentials:      private git dependency URL carrying deployment credentials
    // reading gauges:
    // - zero hits of the deployment credential's password value in the whole result
    // - presence of the username in the purl's source-address qualifier and in the external reference
    const credentialCases = [
      {
        subject: 'registry-with-credentials',
        qualifierName: 'download_url',
        credentialedPackage: '@acme/mirror-lib',
        username: 'deploy-mirror-bot',
        passwordEncoded: 'mIrr0r%23p%40ss%2F2026',
        sanitizedUrl: 'https://deploy-mirror-bot@npm-mirror.corp.example/@acme/mirror-lib/-/mirror-lib-1.4.2.tgz',
        controlPackage: 'control-lib',
        controlResolved: 'https://npm-mirror.corp.example/control-lib/-/control-lib-2.0.0.tgz',
        publicPackage: 'public-lib',
        publicPurl: 'pkg:npm/public-lib@3.1.0'
      },
      {
        subject: 'git-with-credentials',
        qualifierName: 'vcs_url',
        credentialedPackage: 'git-lib',
        username: 'git-deploy-bot',
        passwordEncoded: 'g1t%3Ap%40ss%23word',
        sanitizedUrl: 'git+https://git-deploy-bot@git.corp.example/acme/git-lib.git#v2.3.4',
        controlPackage: 'plain-git-lib',
        controlResolved: 'git+https://git.corp.example/acme/plain-git-lib.git#v1.0.0'
      }
    ]

    test.each(credentialCases)('$subject', async (dd) => {
      const logFileBase = join(tmpRootRun, dd.subject)
      const cwd = dummyProjectsRoot

      const { res, outFile, errFile } = runCLI([
        '-vvv',
        '--output-reproducible',
        '--validate',
        // no intention to test all the spec-versions nor all the output-formats - this would be not our scope.
        '--spec-version', `${latestCdxSpecVersion}`,
        // just use json with the latest most feature-rich version.
        '--output-format', 'JSON',
        // prevent file interaction in this synthetic scenario - they would not exist anyway
        '--package-lock-only',
        '--',
        // just some dummy project
        join('with-lockfile', 'package.json')
      ], logFileBase, cwd, {
        CT_SUBJECT: dd.subject,
        npm_execpath: npmLsReplacement.collectedResults
      })

      try {
        // exit code 0 implies that the result passed the strict validation (`--validate`)
        await expect(res).resolves.toBe(0)
      } catch (err) {
        process.stderr.write(readFileSync(errFile))
        throw err
      }

      const actualOutput = readFileSync(outFile, 'utf8')

      // the deployment credential's password must not leak anywhere in the result,
      // neither in its percent-encoded form nor decoded
      expect(actualOutput).not.toContain(dd.passwordEncoded)
      expect(actualOutput).not.toContain(decodeURIComponent(dd.passwordEncoded))

      const bom = JSON.parse(actualOutput)
      const fullName = (c) => `${c.group === undefined ? '' : `${c.group}/`}${c.name}`

      // the purl's source-address qualifier carries the sanitized URL:
      // password stripped, username kept
      const component = bom.components.find((c) => fullName(c) === dd.credentialedPackage)
      expect(component).toBeDefined()
      const qualifierMatch = component.purl.match(new RegExp(`[?&]${dd.qualifierName}=([^&#]+)`))
      expect(qualifierMatch).not.toBeNull()
      expect(decodeURIComponent(qualifierMatch[1])).toBe(dd.sanitizedUrl)
      expect(decodeURIComponent(qualifierMatch[1])).toContain(dd.username)

      // the external reference keeps its existing sanitization: password stripped, username kept
      const extRef = component.externalReferences.find((r) => r.type === 'distribution')
      expect(extRef).toBeDefined()
      expect(extRef.url).toBe(dd.sanitizedUrl)
      expect(extRef.url).toContain(dd.username)

      // credential-free components keep their purl byte-identical
      const control = bom.components.find((c) => fullName(c) === dd.controlPackage)
      expect(control).toBeDefined()
      const controlQualifierMatch = control.purl.match(new RegExp(`[?&]${dd.qualifierName}=([^&#]+)`))
      expect(controlQualifierMatch).not.toBeNull()
      expect(decodeURIComponent(controlQualifierMatch[1])).toBe(dd.controlResolved)

      // components from the default public registry get no source-address qualifier at all
      if (dd.publicPackage !== undefined) {
        const publicComponent = bom.components.find((c) => fullName(c) === dd.publicPackage)
        expect(publicComponent).toBeDefined()
        expect(publicComponent.purl).toBe(dd.publicPurl)
      }
    }, cliRunTestTimeout)
  })
})
