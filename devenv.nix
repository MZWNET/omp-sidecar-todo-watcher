{
  inputs,
  lib,
  pkgs,
  ...
}: {
  overlays = [inputs.js-toolchain-overlay.overlays.default];

  languages = {
    javascript = {
      enable = true;
      nodejs.enable = false;
      # Requires Node.js; languages.typescript.lsp provides the same server
      lsp.enable = false;
      bun = {
        enable = true;
        package = lib.defaultTo pkgs.bun-bin.latest (pkgs.bun-bin.fromProject ./.);
      };
    };
    typescript = {
      enable = true;
      lsp.enable = true;
    };
  };

  # The tools run on the whole project because they reject explicitly passed files that their ignore rules exclude
  git-hooks.hooks = {
    format = {
      enable = true;
      name = "oxfmt";
      entry = "bun run format";
      pass_filenames = false;
    };
    lint = {
      enable = true;
      name = "oxlint";
      entry = "bun run lint:fix";
      files = "\\.[cm]?[jt]sx?$";
      pass_filenames = false;
    };
    # omp installs plugins by copying the repository, so the committed dist/ must match src/
    build-dist = {
      enable = true;
      name = "Build dist";
      entry = "bun run build";
      files = "^(src/|package\\.json$|bun\\.lock$|tsdown\\.config\\.ts$)";
      pass_filenames = false;
      after = ["format" "lint"];
    };
  };

  enterTest = ''
    bun --version
  '';
}
