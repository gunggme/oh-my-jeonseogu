# oh-my-jeonseogu

디스코드 유저 "전서구"의 말투에서 영감을 받은 캐릭터와 대화하는 장난스러운 CLI.
실제 인물이 아니라 그 말투에서 영감을 받은 캐릭터다. 말투 설계의 근거는
[docs/jeonseogu-style-research.md](docs/jeonseogu-style-research.md)에 있다.
추가 문맥 조사와 수정 근거는 [2026-09-23 조사](docs/jeonseogu-context-review-2026-09-23.md)에 정리했다.

[pi](https://github.com/earendil-works/pi)의 TUI 하네스(`@earendil-works/pi-coding-agent`)를
그대로 띄우고 시스템 프롬프트만 페르소나로 교체한다. 로그인, 모델 선택, 세션 관리,
키바인딩 등은 전부 pi 네이티브다.

## 준비

Node.js 22.19 이상이 필요하다.

API 키가 하나 필요하다. pi와 같은 자격증명을 쓴다 (~/.pi/agent/auth.json 공유):

- TUI 안에서 `/login` (브라우저 OAuth: anthropic, github-copilot, openai-codex 등)
- 환경변수: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` 등
- 또는 `pi` CLI 로그인

## 설치

```sh
npm install -g oh-my-jeonseogu
```

## 실행

```sh
jeonseogu                  # pi TUI가 페르소나로 열림
jeonseogu "전서구야 뭐해"   # 한 번만 답하고 종료 (pi --print와 동일)
```

실행하면 pi의 기본 헤더 대신 OH-MY JEONSEOGU 블록 타이포와 비둘기 ASCII 아트가 뜬다
(`src/banner.ts`에서 확장 팩토리로 헤더를 교체). `--print` 등 비대화 모드에서는 안 뜬다.

모든 pi 플래그가 그대로 통한다 (`--model`, `-c/--continue`, `--no-session`,
`--thinking`, `-e <path>` 등). `jeonseogu --help`는 pi의 도움말과 같다.

전서구 전용 플래그는 `--persona <path>` (다른 페르소나 파일 사용)와
`--no-update` (시작 시 업데이트 확인 끄기)다.

## 기본값

플래그 없이 실행하면 아래가 자동으로 주입된다:

| 주입되는 pi 플래그 | 의미 | 해제 방법 |
| --- | --- | --- |
| `--system-prompt <페르소나>` | 시스템 프롬프트를 페르소나로 교체 | `--system-prompt`/`--append-system-prompt`를 직접 전달 |
| `--no-tools` | 순수 대화 (코딩 도구 끔) | `--tools read,bash,...` 등 pi의 도구 플래그를 직접 전달 |
| `--no-extensions --no-skills` | 사용자 pi 설정에서 확장/스킬 유입 차단 | `--extension`/`--skill`로 명시적 지정 |
| `--no-context-files` | cwd의 AGENTS.md/CLAUDE.md 유입 차단 | 없음 (페르소나 순수성 유지용) |
| `--append-system-prompt ""` | 전역·프로젝트의 APPEND_SYSTEM.md 자동 유입 차단 | 사용자 프롬프트 플래그를 직접 전달 |

## 모델 선택과 시작 기본값

저장된 모델이 없는 첫 대화형 실행에서는 **사용 가능한 최신 버전**을 자동 선택한다.
pi가 먼저 고른 제공자·모델 계열 안에서 GPT, Claude, Gemini의 버전 번호를 비교한다.
예를 들어 기본 후보가 GPT-5.5이고 같은 제공자에 GPT-6 계열이 있으면 GPT-6을 고른다.
같은 버전에서는 기존 변형(예: Sol)을 우선하고, 없으면 기본형, 그다음 카탈로그 순서를
따른다. 공통 출시일 정보가 없으므로 서로 다른 계열의 출시 순서는 비교하지 않는다.
버전 규칙을 알 수 없는 모델은 pi의 기본값을 유지한다.

첫 자동 선택 전에 해당 제공자의 카탈로그를 최대 3초 동안 갱신한다. 갱신 실패나
`--offline`에서는 번들·캐시 목록을 사용하고, 인증이 없으면 `/login` 후 모델을 선택한다.
자동 선택한 모델도 저장되며, 이후 실행은 최신 버전보다 **마지막 선택**을 우선한다.

TUI에서 `/model`을 열면 pi가 모델 목록을 갱신하고, 현재 인증으로 선택 가능한 모델을
보여 준다. 원하는 최신 모델을 검색해 **Enter**로 선택하면 다음 실행의 기본 모델로도
자동 저장된다. **Ctrl+P**로 모델을 순환한 경우에도 마지막 선택을 기억한다.
예를 들어 GPT-5.5에서 다른 모델로 바꾼 뒤 종료하면, 다음 `jeonseogu` 실행 화면에는
마지막으로 선택한 모델이 표시된다.

기본 모델은 pi의 `settings.json`에 제공자와 모델 ID를 함께 저장한다
(기본 경로 `~/.pi/agent/settings.json`, `PI_CODING_AGENT_DIR` 지정 시 해당 디렉터리).
따라서 같은 설정 디렉터리를 사용하는 pi CLI에도 적용된다. 모델 ID를 코드에 고정하지
않으므로, 갱신된 목록의 새 모델도 동일하게 선택하고 저장할 수 있다.

`--model`로 지정한 일회성 모델, 명시적인 모델 범위(`--models`),
신뢰한 프로젝트의 모델 설정, `-c`/`--resume`으로 복원한
세션은 pi의 우선순위를 유지한다. 명령행 지정·세션 복원·비대화 실행만으로는 마지막
선택을 덮어쓰지 않으며, TUI에서 모델을 변경하면 다시 저장한다. 저장된 모델을 더 이상
사용할 수 없을 때의 대체 모델 선택도 pi에 위임한다.

## 동작 방식

- `src/cli.ts`는 얇은 래퍼다. argv를 매핑한 뒤 pi 패키지의 `main()`을
  그대로 호출하고, 프록시/타임아웃 처리도 pi에 위임한다.
- 페르소나는 [personas/jeonseogu.md](personas/jeonseogu.md) 하나에 정의돼 있다.
  잡담, 장난, 감정 표현, 기술 질문, 작업 부탁 전반에서 상대의 말에 맞는 반응과
  같은 화자의 말투를 유지하도록 지시한다.
  캐릭터는 답변을 `"---"` 줄로 나눠 여러 메시지처럼 보내는데, pi TUI에서는
  하나의 응답 안에 구분선으로 렌더링된다.
- 세션은 pi와 같은 위치(`~/.pi/agent/sessions`)에 저장되므로 `-c`/`--resume`이
  pi 세션 피커와 호환된다.

## 시작 시 업데이트

대화형 실행 시 npm registry를 확인한다(24시간 캐시, 요청당 최대 4초).
oh-my-jeonseogu나 번들된 pi 하네스의 새 버전이 있으면 대화 시작 전에 버전과 선택지를 보여 준다:

```text
새 업데이트가 있습니다
oh-my-jeonseogu v0.2.3 → v0.2.4

› 1. 지금 업데이트
  2. 이번에는 건너뛰기
  3. 다음 버전까지 알리지 않기
```

방향키와 Enter 또는 숫자 1~3으로 선택한다. Esc는 이번 실행만 건너뛴다.
`지금 업데이트`를 선택해야 `npm install -g oh-my-jeonseogu@latest`가 실행되며,
설치 진행 상황을 터미널에 표시한다. 완료되면 재실행 안내 후 종료한다.
**`jeonseogu`를 다시 실행해야 최신 버전으로 대화를 시작한다.** 설치 실패 시에는
수동 설치 명령을 안내하고 종료 코드 1로 끝난다.

건너뛰면 현재 버전으로 바로 대화한다. `다음 버전까지 알리지 않기`는 캐시가 만료돼도
유지되며, 전서구나 pi에 더 새 버전이 나오면 다시 알린다. pi 의존성은 `latest` 태그를
사용하므로 0.x의 마이너 버전에도 묶이지 않는다.

`--no-update`, `JEONSEOGU_NO_UPDATE=1`, `--offline`/`PI_OFFLINE=1`, 개발 체크아웃(`npm run dev`)에서는
확인을 생략한다. `--print`, JSON/RPC 모드, 파이프 입출력, 도움말·버전·모델 목록·관리 명령에서는
업데이트 메뉴와 설치를 실행하지 않는다. 네트워크 확인에 실패하면 현재 버전으로 계속 시작한다.

개발 체크아웃에서는 `npm run update:pi`로 최신 pi와 모델 목록을 가져오고 다시 빌드한다.
`package-lock.json`은 재현 가능한 설치를 위해 유지하며, 이 명령으로 함께 갱신한다.
pi는 모델 카탈로그도 자동으로 갱신한다. `/model`에서 `astra`나 `luna`를 검색하거나
`npm start -- --list-models astra`로 사용 가능한 모델을 확인할 수 있다.

## 개발

수정 및 PR 작성 규칙은 [AGENTS.md](AGENTS.md)를 따른다.
모든 PR에는 관련 이슈가 필요하며, 기존 이슈가 없으면 PR 생성 전에 먼저 만든다.

```sh
npm run dev      # tsx로 바로 실행
npm run check    # tsc --noEmit
npm test         # argv, 프롬프트 격리, 업데이터 테스트
npm run test:package # 배포 tarball을 새 디렉터리에 설치하고 CLI 실행 검증
npm run eval:persona -- --out /tmp/persona-results.jsonl # gpt-5.5/medium 반복 평가 (인증 필요)
npm run update:pi # 최신 pi 설치 + 빌드
```

페르소나를 수정하면 [대화 평가 시나리오](docs/persona-evaluation.md)로 실제 모델의
응답도 확인한다. 문구가 프롬프트에 들어 있는지만으로 말투 유지 여부를 검증할 수는 없다.

PR 검증, AI 코드 리뷰, `master` 기준 npm 자동 배포 설정과 공개 전환 절차는
[릴리스 가이드](docs/releasing.md)에 정리했다.
