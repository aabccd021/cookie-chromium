{

  nixConfig.allow-import-from-derivation = false;
  nixConfig.extra-substituters = [
    "https://cache.garnix.io"
    "https://nix-community.cachix.org"
  ];
  nixConfig.extra-trusted-public-keys = [
    "cache.garnix.io:CTFPyKSLcx5RMJKfLo5EEPUObbA78b0YQ2DTCJXqr9g="
    "nix-community.cachix.org-1:mB9FSh9qf2dCimDSUo8Zy7bkq5CX+/rkCWyvRCYg3Fs="
  ];

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  inputs.treefmt-nix.url = "github:numtide/treefmt-nix";
  inputs.bun2nix.url = "github:baileyluTCD/bun2nix";

  outputs = { self, ... }@inputs:
    let

      nodeModules = inputs.bun2nix.lib.x86_64-linux.mkBunNodeModules (import ./bun.nix);

      overlay = (final: prev: {
        cookie-chromium = final.writeShellApplication {
          name = "cookie-chromium";
          runtimeEnv.NODE_PATH = "${nodeModules}/node_modules";
          runtimeEnv.PLAYWRIGHT_BROWSERS_PATH = final.playwright.browsers-chromium;
          text = ''
            exec ${final.bun}/bin/bun run ${./index.ts} "$@"
          '';
        };
      });

      pkgs = import inputs.nixpkgs {
        system = "x86_64-linux";
        overlays = [ overlay ];
      };

      lib = pkgs.lib;

      treefmtEval = inputs.treefmt-nix.lib.evalModule pkgs {
        projectRootFile = "flake.nix";
        programs.nixpkgs-fmt.enable = true;
        programs.prettier.enable = true;
        programs.biome.enable = true;
        programs.shfmt.enable = true;
        programs.shellcheck.enable = true;
        settings.formatter.prettier.priority = 1;
        settings.formatter.biome.priority = 2;
        settings.formatter.shellcheck.options = [ "-s" "sh" ];
        settings.global.excludes = [ "LICENSE" ];
      };

      typecheck = pkgs.runCommandLocal "cookie_browser_typecheck" { } ''
        cp -Lr ${nodeModules}/node_modules ./node_modules
        cp -L ${./tsconfig.json} ./tsconfig.json
        cp -L ${./index.ts} ./index.ts
        ${pkgs.typescript}/bin/tsc
        touch "$out"
      '';

      lintCheck = pkgs.runCommandLocal "lintCheck" { } ''
        cp -Lr ${./index.ts} ./index.ts
        cp -Lr ${nodeModules}/node_modules ./node_modules
        cp -L ${./biome.jsonc} ./biome.jsonc
        cp -L ${./tsconfig.json} ./tsconfig.json
        cp -L ${./package.json} ./package.json
        ${pkgs.biome}/bin/biome check --error-on-warnings
        touch $out
      '';

      packages = {
        formatting = treefmtEval.config.build.check self;
        typecheck = typecheck;
        lintCheck = lintCheck;
        cookie-chromium = pkgs.cookie-chromium;
        default = pkgs.cookie-chromium;
        bun2nix = inputs.bun2nix.packages.x86_64-linux.default;
      };

      gcroot = packages // {
        gcroot = pkgs.linkFarm "gcroot" packages;
      };

    in
    {
      packages.x86_64-linux = gcroot;
      checks.x86_64-linux = gcroot;
      formatter.x86_64-linux = treefmtEval.config.build.wrapper;
      overlays.default = overlay;

      apps.x86_64-linux.default = {
        type = "app";
        program = lib.getExe packages.default;
      };

    };
}
