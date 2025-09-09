{

  nixConfig.allow-import-from-derivation = false;

  inputs.nixpkgs.url = "github:nixos/nixpkgs/nixos-unstable";
  inputs.treefmt-nix.url = "github:numtide/treefmt-nix";

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

      overlay = (
        final: prev:
        let
          npm_deps = import ./npm_deps.nix { pkgs = final; };
        in
        {

          cookie-chromium = final.writeShellApplication {
            name = "cookie-chromium";
            runtimeEnv.NODE_PATH = "${npm_deps}/lib/node_modules";
            runtimeEnv.PLAYWRIGHT_BROWSERS_PATH = final.playwright.browsers-chromium;
            text = ''
              exec ${final.bun}/bin/bun run ${./index.ts} "$@"
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
        programs.biome.settings = builtins.fromJSON (builtins.readFile ./biome.json);
        programs.biome.formatUnsafe = true;
        settings.formatter.biome.options = [ "--vcs-enabled=false" ];
        programs.shfmt.enable = true;
        programs.shellcheck.enable = true;
        settings.formatter.shellcheck.options = [
          "-s"
          "sh"
        ];
        settings.global.excludes = [ "LICENSE" ];
      };

      formatter = treefmtEval.config.build.wrapper;

      npm_deps = import ./npm_deps.nix { pkgs = pkgs; };

      update-npm-deps = pkgs.writeShellApplication {
        name = "update-npm-deps";
        text = ''
          repo_root=$(git rev-parse --show-toplevel)
          nix run github:aabccd021/bun3nix install playwright@1.54.1 @types/node \
            > "$repo_root/npm_deps.nix"
        '';
      };

      typecheck = pkgs.runCommandLocal "cookie_browser_typecheck" { } ''
        cp -Lr ${npm_deps}/lib/node_modules ./node_modules
        cp -L ${./tsconfig.json} ./tsconfig.json
        cp -L ${./index.ts} ./index.ts
        ${pkgs.typescript}/bin/tsc
        touch "$out"
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

      packages = devShells // {
        formatting = treefmtEval.config.build.check self;
        formatter = formatter;
        allInputs = collectInputs inputs;
        typecheck = typecheck;
        cookie-chromium = pkgs.cookie-chromium;
        default = pkgs.cookie-chromium;
        update-npm-deps = update-npm-deps;
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
