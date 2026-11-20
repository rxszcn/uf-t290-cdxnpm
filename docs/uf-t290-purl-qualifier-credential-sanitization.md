# UF-T290 交付文档：purl 源地址限定字段凭据泄漏修复

日期：2026-11-21
范围：组件工厂（`src/factories.ts`）及其集成测试；改动面未触及其他生产代码。

## 1. 问题与根因

企业发布管线将私有镜像源拉包地址与私有 git 依赖地址（均内嵌部署凭据）经 SBOM 过发布卡点归档。
审计发现：同一组件、同一来源字符串（npm-ls 采集数据中的 `resolved`）在产物中有两处输出，净化行为不一致——

- **外部引用字段**（`externalReferences[]`，type=distribution）：经 `tryRemoveSecretsFromUrl()`
  （`src/_helpers.ts:55`）净化，密码剥离、用户名保留；
- **purl 源地址限定字段**（`vcs_url` / `download_url` qualifier）：在组件工厂
  `PackageUrlFactory`（`src/factories.ts`）中被**原样**写入，凭据以百分号编码形态完整保留、可还原，
  拿到归档清单的下游即可读出部署凭据。

根因定位：`src/factories.ts` 中三处限定字段装配点直接使用未净化的来源字符串——

1. `makeFromPackageData()`：`data.resolved` 原样写入 `vcs_url`（git 来源）与 `download_url`（镜像源拉包）；
2. `makeFromPackageJson()`：`packageJson.dist.tarball` 原样写入 `download_url`；
3. `makeFromPackageJson()`：`packageJson.repository.url` 原样写入 `vcs_url`。

外部引用路径（`src/builders.ts:515`）早已净化，purl 路径漏洗，同源数据一处洗一处不洗。
公共源（`registry.npmjs.org`）依赖按既有逻辑不生成限定字段，为天然对照组，无泄漏。

修复前实测（构造输入见 §4）：`git-with-credentials` 用例的 purl 限定字段解码后为
`git+https://git-deploy-bot:g1t%3Ap%40ss%23word@git.corp.example/acme/git-lib.git#v2.3.4`，
密码值串在场，泄漏复现。

## 2. 修复方案

### 净化入口与复用方式取舍（设计决定及理由）

- **净化入口收在组件工厂** `src/factories.ts`：新增模块级函数 `sanitizeUrlForPurlQualifier()`，
  在上述三处限定字段装配点统一调用。`resolved` 在产物中的全部落点仅为 purl 限定字段与外部引用
  （已核对 `src/builders.ts`），入口收在工厂即可闭环，改动面不外溢。
- **复用既有 `tryRemoveSecretsFromUrl()` 执行实际剥离**：净化语义与外部引用字段"按构造对齐"
  （同一函数：密码剥离、用户名保留、不可解析为 URL 时原样返回），而非另写一套规则，杜绝两处语义漂移。
- **不改动 `tryRemoveSecretsFromUrl()` 本身**：外部引用字段的既有净化行为按构造零回归。
- **无密码快路径原样返回**：`sanitizeUrlForPurlQualifier()` 先以 `new URL()` 探测，
  无密码（或不可解析）时逐字节返回原串。理由：直接对所有限定字段值套 `URL` 往返会在边角情形
  （裸主机补 `/`、默认端口省略、主机名大小写归一等）改写无凭据组件的 purl，
  快路径保证"凭据无关组件的 purl 与既有快照逐字节一致"是对所有输入成立的性质，而非仅对现有 fixture 凑巧成立。
  （现有 fixture 全量 1053 个 `resolved` 值经核对，仅被两条路径共同忽略的 `file:` 前缀值往返不一致。）
- `makeFromPackageJson()` 的 `repository.url` 分支本就走 `new URL(...).toString()` 归一化，
  故在该分支直接 `url.password = ''`（同一语义：密码剥离、用户名保留），无凭据时输出与修复前逐字节一致。

## 3. 逐文件改动登记

| 文件 | 改动 |
| --- | --- |
| `src/factories.ts` | 新增 `sanitizeUrlForPurlQualifier()`；`makeFromPackageData()` 的 `vcs_url`/`download_url`、`makeFromPackageJson()` 的 `download_url`（tarball）三处装配点改经净化；`repository.url` 分支增加 `url.password = ''`。 |
| `tests/_data/npm-ls_credentials/registry-with-credentials.json` | 新增。构造输入一：带凭据私有镜像源拉包地址的预置 npm-ls 采集数据（含无凭据私有源对照组件、公共源对照组件）。 |
| `tests/_data/npm-ls_credentials/git-with-credentials.json` | 新增。构造输入二：带凭据私有 git 依赖地址的预置 npm-ls 采集数据（含无凭据 git 来源对照组件）。 |
| `tests/_data/npm-ls_replacement/collected-results.js` | 新增。npm 替换脚本：响应 `--version`，并按 `CT_SUBJECT` 输出 `tests/_data/npm-ls_credentials/<subject>.json`，全程快照环境内零外部依赖。 |
| `tests/integration/index.js` | `npmLsReplacement` 登记 `collectedResults` 路径。 |
| `tests/integration/cli.from-collected.test.js` | 新增 `with prepared npm-ls containing credentials` 描述块，镜像源带凭据、git 来源带凭据两类断言用例，沿用该文件既有 `runCLI` 框架与参数口径。 |

未改动：`src/_helpers.ts`（`tryRemoveSecretsFromUrl` 原样复用）、`src/builders.ts`（外部引用路径不动）、
`tests/_data/sbom_demo-results/` 全部既有快照（逐字节一致由 135 条既有用例验证）。

## 4. 构造输入与读数口径（写死）

### 构造输入（预置依赖采集数据，快照环境内零外部依赖可复现）

- **镜像源带凭据输入**（`registry-with-credentials.json`）：
  `@acme/mirror-lib@1.4.2` 的 `resolved` =
  `https://deploy-mirror-bot:mIrr0r%23p%40ss%2F2026@npm-mirror.corp.example/@acme/mirror-lib/-/mirror-lib-1.4.2.tgz`
  - 用户名值串：`deploy-mirror-bot`
  - 密码值串（百分号编码形态）：`mIrr0r%23p%40ss%2F2026`；解码形态：`mIrr0r#p@ss/2026`
  - 对照组件：`control-lib@2.0.0`（无私有源凭据，`https://npm-mirror.corp.example/control-lib/-/control-lib-2.0.0.tgz`）、
    `public-lib@3.1.0`（公共源 `https://registry.npmjs.org/public-lib/-/public-lib-3.1.0.tgz`，无限定字段对照组）
- **git 来源带凭据输入**（`git-with-credentials.json`）：
  `git-lib@2.3.4` 的 `resolved` =
  `git+https://git-deploy-bot:g1t%3Ap%40ss%23word@git.corp.example/acme/git-lib.git#v2.3.4`
  - 用户名值串：`git-deploy-bot`
  - 密码值串（百分号编码形态）：`g1t%3Ap%40ss%23word`；解码形态：`g1t:p@ss#word`
  - 对照组件：`plain-git-lib@1.0.0`（无凭据 git 来源，`git+https://git.corp.example/acme/plain-git-lib.git#v1.0.0`）

### 读数口径

1. 生成产物**全文**中部署凭据密码值串**零命中**（编码形态与解码形态分别计）；
2. 用户名值串在 **purl 源地址限定字段**（`download_url` / `vcs_url`，purl 串中百分号解码后取值）及
   **外部引用字段**（`externalReferences[type=distribution].url`）的**在场**读数；
3. 净化语义对齐：两处输出一致，均为密码剥离、用户名保留后的同一来源字符串；
4. 凭据无关组件的 purl 与既有快照逐字节一致（既有 135 条快照用例 + 对照组件限定字段解码值与输入逐字节相等）；
5. 净化后的产物仍通过 `--validate` 严格校验（CLI 退出码 0）。

## 5. 实测读数（修复后，`--spec-version 1.7 --output-format JSON --output-reproducible --validate --package-lock-only`）

### 镜像源带凭据输入（registry-with-credentials）

- 密码值串命中：编码形态 `mIrr0r%23p%40ss%2F2026` = **0**，解码形态 `mIrr0r#p@ss/2026` = **0**
- 用户名 `deploy-mirror-bot` 全文命中 = 2（purl 限定字段 1 + 外部引用字段 1）
- `@acme/mirror-lib` purl：
  `pkg:npm/%40acme/mirror-lib@1.4.2?download_url=https%3A%2F%2Fdeploy-mirror-bot%40npm-mirror.corp.example%2F%40acme%2Fmirror-lib%2F-%2Fmirror-lib-1.4.2.tgz`
  （限定字段解码 = `https://deploy-mirror-bot@npm-mirror.corp.example/@acme/mirror-lib/-/mirror-lib-1.4.2.tgz`）
- 外部引用：`https://deploy-mirror-bot@npm-mirror.corp.example/@acme/mirror-lib/-/mirror-lib-1.4.2.tgz`（与限定字段同源同值）
- 对照：`control-lib` 限定字段解码 = 输入原串（逐字节一致）；`public-lib` purl = `pkg:npm/public-lib@3.1.0`（无限定字段）
- CLI 退出码 0（严格校验通过）

### git 来源带凭据输入（git-with-credentials）

- 密码值串命中：编码形态 `g1t%3Ap%40ss%23word` = **0**，解码形态 `g1t:p@ss#word` = **0**
- 用户名 `git-deploy-bot` 全文命中 = 2（purl 限定字段 1 + 外部引用字段 1）
- `git-lib` purl：
  `pkg:npm/git-lib@2.3.4?vcs_url=git%2Bhttps%3A%2F%2Fgit-deploy-bot%40git.corp.example%2Facme%2Fgit-lib.git%23v2.3.4`
  （限定字段解码 = `git+https://git-deploy-bot@git.corp.example/acme/git-lib.git#v2.3.4`）
- 外部引用：`git+https://git-deploy-bot@git.corp.example/acme/git-lib.git#v2.3.4`（与限定字段同源同值）
- 对照：`plain-git-lib` 限定字段解码 = 输入原串（逐字节一致）
- CLI 退出码 0（严格校验通过）

## 6. 验收命令与结果

```bash
npm install   # 仓库无 package-lock.json，npm ci 不适用
npm run build
npx jest tests/integration/cli.from-collected.test.js
```

结果：**137/137 通过**（既有 135 条快照用例零失败——凭据无关组件 purl 与既有快照逐字节一致、
外部引用既有净化行为不回归；新增 2 条带凭据净化断言用例通过）。
`npm run lint`（`tsc --noEmit`）通过。

备注：本仓库 `npm run build` 的 `prebuild` 只清 `dist/` 不清根目录 `tsconfig.tsbuildinfo`，
`tsc -b` 在增量信息残留时可能不重编译（既有行为，非本次改动引入）；干净环境（无
`tsconfig.tsbuildinfo`）下 `npm run build` 即全量编译。若本地遇到 dist 未更新，删除
`tsconfig.tsbuildinfo` 后重新 `npm run build` 即可。

## 7. 需求逐条对照

| 要求 | 落点 | 状态 |
| --- | --- | --- |
| 定位根因并修复 | §1、§2；`src/factories.ts` | ✅ |
| 带凭据来源的 purl 限定字段不得携带凭据 | 三处装配点经 `sanitizeUrlForPurlQualifier()` / `url.password=''` | ✅ 实测密码值串 0 命中 |
| 净化语义与外部引用对齐（密码剥离、用户名保留） | 复用同一 `tryRemoveSecretsFromUrl()` | ✅ 两处输出同值 |
| 凭据无关组件 purl 与既有快照逐字节一致 | 无密码快路径原样返回；135 条既有快照用例 | ✅ 零失败 |
| 净化后仍通过清单严格校验 | 用例带 `--validate`，退出码 0 | ✅ |
| 外部引用既有净化行为不回归 | `tryRemoveSecretsFromUrl` 与 `builders.ts` 未改动 | ✅ 既有用例零失败 |
| 净化入口与复用取舍写明理由 | §2 | ✅ |
| 构造输入与读数口径写死 | §4 | ✅ |
| 两类断言用例补齐至既有集成测试文件、沿用既有框架 | `cli.from-collected.test.js` 新增描述块，复用 `runCLI`/`mkTemp` 框架 | ✅ |
| 改动面收在组件工厂实现及其测试 | §3 逐文件登记 | ✅ |
| 既有测试保持通过；验收以 build + jest 零失败为准 | §6 | ✅ 137/137 |
