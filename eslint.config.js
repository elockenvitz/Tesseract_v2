// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import storybook from "eslint-plugin-storybook";

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { globalIgnores } from 'eslint/config'

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // Scoped to the mobile feed, where #138 broke production: a useMemo
    // dependency array read a `const` declared 61 lines below it, and tsc, 80
    // unit tests and 26 browser assertions all went green while every
    // logged-in user got a loading spinner.
    //
    // Ratcheted, not global. 137 violations exist repo-wide; none get
    // allowlisted invisibly. Widen one directory at a time, each widening
    // reported with its count before it lands.
    //
    // functions: false because function declarations hoist and referencing
    // them early is idiomatic here. It is `const` and `let` that throw.
    files: ['src/components/mobile/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-use-before-define': ['error', {
        variables: true,
        functions: false,
        classes: false,
        enums: false,
        typedefs: false,
        ignoreTypeReferences: true,
      }],
    },
  },
], storybook.configs["flat/recommended"]);
