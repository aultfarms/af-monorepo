import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { defineConfig } from 'rollup';

const plugins = [ resolve({
  preferBuiltins: false,
  browser: true
}), commonjs() ];

const watch = {
  buildDelay: 200,
  include: "dist/**/*.js",
  exclude: [ "dist/index.mjs" ],
};

export default defineConfig([
  {
    input: "dist/index.js",
    external: [
      /^firebase($|\/)/,
    ],
    plugins,
    watch,
    output: {
      file: "dist/index.mjs",
      format: "esm",
      sourcemap: true
    },
  },
]);
