import { defineConfig } from 'vite'

/**
 * 청크 이름 고정.
 *
 * 설정이 없으면 Vite 가 공용 청크 이름을 **그 안에 든 모듈 하나에서 따옵니다.**
 * 실제로 `@babel/parser`(약 300KB)가 들어 있는 청크가 `parse-error-*.js` 로 불리는 일이
 * 있었습니다 — 빌드 출력만 보면 오류 처리 모듈이 300KB 인 것처럼 읽힙니다.
 *
 * **`@babel/parser` 만** `lib` 으로 모읍니다. `node_modules` 를 통째로 묶으면
 * `prismjs`(하이라이터가 **정적**으로 import)가 같은 청크에 들어가고, 그 순간
 * `lib` 이 초기 로드의 정적 의존이 되어 **babel 300KB 가 첫 화면에 딸려옵니다.**
 * 실제로 그렇게 만들어 보고 `index.html` 에 `modulepreload` 가 붙는 것을 확인했습니다.
 *
 * 지연 로드 설계는 그대로입니다 — `parser.js` / `behavior/` 를 `main.js` 에서
 * 동적 import 하므로 babel 은 초기 번들에서 빠지고 첫 분석 때 따라옵니다.
 */
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@babel')) return 'lib'
        },
      },
    },
  },
})
