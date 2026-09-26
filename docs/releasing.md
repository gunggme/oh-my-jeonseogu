# CI, PR 리뷰, npm 배포

## 파이프라인

| 워크플로 | 실행 시점 | 동작 |
| --- | --- | --- |
| CI | `master` 대상 PR, 수동 실행, 배포 워크플로 호출 | Node 22.19.0 / 24에서 타입 검사, 테스트, tarball 설치 및 CLI 실행 |
| AI review (선택, 기본 비활성) | 활성화 후 PR 생성·갱신·재개·초안 해제, 수동 실행 | Codex가 변경 내용을 검토하고 PR 댓글 하나를 갱신 |
| npm publish | `master` push, 수동 실행 | CI 통과 후 패키지 생성·dry-run, 조건 충족 시 새 버전 발행 |

`CI`가 브랜치 보호에 등록할 최종 검사 이름이다. 모델 인증이 필요한
`eval:persona`는 CI에서 실행하지 않는다. 페르소나 변경 시 유지관리자가 별도로 평가한다.
외부 Actions는 commit SHA로 고정하고 Dependabot이 매주 갱신 PR을 만든다.

## AI 리뷰 활성화

AI 리뷰는 현재 비활성 상태이며 공개 전환의 필수 조건이 아니다.
필요할 때 Actions variable `AI_REVIEW_ENABLED=true`를 설정하고 아래 인증을 추가한다.

저장소 **Settings → Secrets and variables → Actions**에 `OPENAI_API_KEY`를 추가한다.
OpenAI API 사용 요금이 발생한다. 모델을 지정하려면 Actions variable
`AI_REVIEW_MODEL`을 설정한다. 비어 있으면 Codex의 기본 모델을 사용한다.
키가 없으면 준비 단계가 경고를 남기고 모델 실행과 댓글 게시를 건너뛴다.
이 상태는 AI 리뷰 실동작 검증이 완료된 상태가 아니다.

쓰기 권한이 있는 사용자가 발생시킨 PR 이벤트는 자동으로 검토한다.
외부 기여자와 봇 PR은 유지관리자가 Actions의 **AI review → Run workflow**에서
`master`와 PR 번호를 선택해 실행한다. 새 커밋에는 다시 실행해야 한다.

리뷰는 `pull_request_target`으로 신뢰할 수 있는 base 커밋만 체크아웃한다.
PR 코드는 diff 텍스트로 읽으며 설치·빌드·실행하지 않는다. Codex는 읽기 전용
샌드박스와 `drop-sudo`로 실행하며, 댓글 작성은 별도 runner와 토큰으로 수행한다.
초안·닫힌 PR, `master` 외 대상, 오래된 커밋의 결과는 게시하지 않는다.
250 KB를 넘는 diff는 불완전하게 검토하지 않고 실패 처리한다.
AI 의견은 사람의 승인이나 필수 CI 검사를 대체하지 않는다.

## npm 최초 연결

현재 패키지가 npm에 없으면 먼저 한 번의 인증된 최초 발행이 필요하다.
GitHub 저장소를 비공개로 유지한 채 npm 패키지를 **공개** 발행할 수 있다.
아래 명령은 GitHub의 공개 설정을 변경하지 않는다.

최초 발행 전에 npm 계정 설정에서 **Two-Factor Authentication**을 활성화한다.
이메일 OTP로 CLI 로그인에 성공했어도 계정 2FA가 꺼져 있으면 `npm publish`는
403을 반환한다. npm이 지원하는 패스키·Touch ID·보안 키를 등록하고 복구 코드를
보관한 뒤 진행한다. Trusted Publisher 설정에도 계정 2FA가 필요하다.

```sh
npm login
npm ci
npm run check
npm test
npm run test:package
npm pack
release_version=$(node -p 'JSON.parse(require("node:fs").readFileSync("package.json", "utf8")).version')
npm publish "oh-my-jeonseogu-$release_version.tgz" --access public --ignore-scripts
node scripts/verify-published.mjs "oh-my-jeonseogu-$release_version.tgz"
```

패키지가 생성되면 npm 패키지 Settings의 **Trusted Publisher**를 등록한다:

| 항목 | 값 |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `gunggme` |
| Repository | `oh-my-jeonseogu` |
| Workflow filename | `publish.yml` |
| Environment | 비워 둠 |
| Allowed actions | `npm publish` 허용 |

npm 11.15 이상에서는 같은 설정을 CLI로 할 수도 있다(2FA 인증 필요):

```sh
npm trust github oh-my-jeonseogu --repo gunggme/oh-my-jeonseogu --file publish.yml --allow-publish
```

GitHub에는 npm 토큰을 저장하지 않는다. Node 24의 npm과 GitHub OIDC로 발행하고,
공개 저장소에서 provenance를 첨부한다. 비공개 저장소는 npm의 제한으로 provenance
없이 발행하며, public 전환 후 발행되는 새 버전부터 자동으로 provenance를 첨부한다.
기존 버전의 provenance는 소급해서 추가할 수 없다.
Actions variable `NPM_PUBLISH_ENABLED`가 `true`가 아니면 dry-run만 수행한다.
발행 직후에는 npm registry의 tarball SHA-512가 로컬 배포 파일과 일치하는지도 검사한다.

## 공개 전환과 활성화

1. 비공개 상태에서 `CI`와 `npm publish` dry-run 성공을 확인한다.
2. AI 리뷰를 사용하려면 별도로 활성화한 뒤 실제 PR의 댓글을 확인한다(선택).
3. 최초 npm 발행과 Trusted Publisher 등록을 완료한다.
4. `NPM_PUBLISH_ENABLED=true`로 설정하고 새 버전 PR로 실제 자동 발행을 확인한다.
5. 공개할 코드·문서·이력 검토까지 마쳤으면 공개 전환 직전의 준비가 끝난 상태다.
6. 이후 public으로 전환할 때 아래 브랜치 보호를 적용한다. 다음 새 버전에서 provenance를 확인한다.

저장소 공개 변경은 파이프라인이나 아래 명령이 자동으로 수행하지 않는다.
`docs/jeonseogu-style-research.md`와 `docs/jeonseogu-context-review-2026-09-23.md`에는
Discord 대화 인용과 원문 링크가 있고 Git 이력에도 포함되어 있다. npm tarball에는
이 조사 문서와 `eval/`을 포함하지 않는다. GitHub 공개 범위는 별도로 확인한다.

현재 GitHub Free의 비공개 저장소에서는 브랜치 보호 API가 403을 반환한다.
공개 전환 후 아래 명령으로 준비된 설정을 적용한다:

```sh
gh api --method PUT repos/gunggme/oh-my-jeonseogu/branches/master/protection \
  --input .github/branch-protection.json
```

배포 활성화는 저장소의 공개 여부와 별개로 최초 연결을 완료한 뒤 실행한다:

```sh
gh variable set NPM_PUBLISH_ENABLED --repo gunggme/oh-my-jeonseogu --body true
```

이 설정은 최신 `master` 반영, `CI` 성공, 코드 소유자 승인 1회, 대화 해결을 요구하고
force push와 브랜치 삭제를 금지한다. 소유자 자신의 PR은 스스로 승인할 수 없으므로
관리자 우회는 허용한다. 리뷰 담당자가 늘어나면 `CODEOWNERS`를 갱신한다.
위 명령은 기존 보호 설정을 교체하므로 이후 재적용할 때는 변경 내용을 먼저 확인한다.

## 일반 릴리스

```sh
npm version patch --no-git-tag-version # 변경 규모에 따라 minor 또는 major
```

`package.json`과 `package-lock.json`을 함께 PR에 포함하고 `master`에 병합한다.
동일 버전이 이미 npm에 있으면 발행을 건너뛰므로 문서 수정이나 재실행으로 중복
발행되지 않는다. `latest`보다 낮은 버전과 prerelease 버전은 거부한다.
registry 통신 오류를 신규 패키지로 오인하지 않는다.

실패한 발행은 Actions에서 다시 실행하거나 **npm publish → Run workflow**에서
`master`, `dry_run=false`로 재시도한다. 수동 실행의 기본값은 `dry_run=true`다.
자동 발행을 중지하려면 `NPM_PUBLISH_ENABLED=false`로 설정한다.

참고: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/),
[npm trust](https://docs.npmjs.com/cli/v11/commands/npm-trust/),
[Codex GitHub Action](https://developers.openai.com/codex/github-action),
[GitHub 브랜치 보호](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
