{

  nixConfig.allow-import-from-derivation = false;

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  inputs.treefmt-nix.url = "github:numtide/treefmt-nix";
  inputs.bun2nix.url = "github:baileyluTCD/bun2nix";

  outputs =
    { self, ... }@inputs:
    let
      lib = inputs.nixpkgs.lib;

      collectInputs =
        is:
        pkgs.linkFarm "inputs" (
          builtins.mapAttrs (
            name: i:
            pkgs.linkFarm name {
              self = i.outPath;
              deps = collectInputs (lib.attrByPath [ "inputs" ] { } i);
            }
          ) is
        );

      nodeModules = inputs.bun2nix.lib.x86_64-linux.mkBunNodeModules {
        packages = import ./bun.nix;
      };

      overlay = (
        final: prev: {
          cookie-chromium = final.writeShellApplication {
            name = "cookie-chromium";
            runtimeEnv.NODE_PATH = "${nodeModules}/node_modules";
            runtimeEnv.PLAYWRIGHT_BROWSERS_PATH = final.playwright.browsers-chromium;
            text = ''
              exec ${final.bun}/bin/bun run ${./index.ts} "$@"
            '';
          };

          test-chromium = final.writeShellApplication {
            name = "test-chromium";
            runtimeEnv.NODE_PATH = "${nodeModules}/node_modules";
            runtimeEnv.PLAYWRIGHT_BROWSERS_PATH = final.playwright.browsers-chromium;
            text = ''
              exec ${final.bun}/bin/bun run ${./src}/netero.ts "$@"
            '';
          };
        }
      );

      pkgs = import inputs.nixpkgs {
        system = "x86_64-linux";
        overlays = [ overlay ];
      };

      treefmtEval = inputs.treefmt-nix.lib.evalModule pkgs {
        projectRootFile = "flake.nix";
        programs.nixfmt.enable = true;
        programs.prettier.enable = true;
        programs.biome.enable = true;
        programs.shfmt.enable = true;
        programs.shellcheck.enable = true;
        settings.formatter.prettier.priority = 1;
        settings.formatter.biome.priority = 2;
        settings.formatter.shellcheck.options = [
          "-s"
          "sh"
        ];
        settings.global.excludes = [ "LICENSE" ];
      };

      formatter = treefmtEval.config.build.wrapper;

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

      devShells.default = pkgs.mkShellNoCC {
        buildInputs = [
          pkgs.bun
          pkgs.biome
          pkgs.typescript
          pkgs.vscode-langservers-extracted
          pkgs.nixd
          pkgs.typescript-language-server
        ];
      };

      prefmt = pkgs.writeShellApplication {
        name = "prefmt";
        runtimeInputs = [ pkgs.biome ];
        text = ''
          biome check --fix --unsafe --error-on-warnings
        '';
      };

      packages = devShells // {
        prefmt = prefmt;
        formatting = treefmtEval.config.build.check self;
        formatter = formatter;
        allInputs = collectInputs inputs;
        typecheck = typecheck;
        lintCheck = lintCheck;
        cookie-chromium = pkgs.cookie-chromium;
        default = pkgs.cookie-chromium;
        bun2nix = inputs.bun2nix.packages.x86_64-linux.default;
      };
    in
    {
      packages.x86_64-linux = packages // {
        gcroot = pkgs.linkFarm "gcroot" packages;
      };

      checks.x86_64-linux = packages;
      formatter.x86_64-linux = formatter;
      overlays.default = overlay;
      devShells.x86_64-linux = devShells;
    };
}
