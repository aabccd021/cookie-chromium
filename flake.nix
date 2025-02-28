{
  nixConfig.allow-import-from-derivation = false;

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    treefmt-nix.url = "github:numtide/treefmt-nix";
  };

  outputs = { self, nixpkgs, treefmt-nix }:
    let

      overlay = (final: prev:
        let
          generated = import ./generated {
            pkgs = final;
            system = "x86_64-linux";
            nodejs = final.nodejs;
          };
        in
        {

          cookie-chromium = final.writeShellApplication {
            name = "cookie-chromium";
            runtimeEnv.NODE_PATH = "${generated.nodeDependencies}/lib/node_modules";
            runtimeEnv.PLAYWRIGHT_BROWSERS_PATH = final.playwright.browsers-chromium;
            text = ''
              exec ${final.bun}/bin/bun run ${./index.ts} "$@"
            '';
          };


        });

      pkgs = import nixpkgs {
        system = "x86_64-linux";
        overlays = [ overlay ];
      };


      generated = import ./generated {
        pkgs = pkgs;
        system = "x86_64-linux";
        nodejs = pkgs.nodejs;
      };




      lib = pkgs.lib;

      treefmtEval = treefmt-nix.lib.evalModule pkgs {
        projectRootFile = "flake.nix";
        programs.nixpkgs-fmt.enable = true;
        programs.prettier.enable = true;
        programs.biome.enable = true;
        programs.shfmt.enable = true;
        programs.shellcheck.enable = true;
        settings.formatter.prettier.priority = 1;
        settings.formatter.biome.priority = 2;
        settings.formatter.shellcheck.options = [ "-s" "sh" ];
        settings.global.excludes = [ "LICENSE" "generated/**" ];
      };


      updateDependencies = pkgs.writeShellApplication {
        name = "update-dependencies";
        text = ''
          trap 'cd $(pwd)' EXIT
          root=$(git rev-parse --show-toplevel)
          cd "$root" || exit
          git add -A
          trap 'git reset >/dev/null' EXIT

          ${pkgs.nodejs}/bin/npm install --lockfile-version 2 --package-lock-only

          rm -rf node_modules
          cd generated
          ${pkgs.node2nix}/bin/node2nix -- --input ../package.json --lock ../package-lock.json
        '';
      };

      typecheck = pkgs.runCommandLocal "cookie_browser_typecheck" { } ''
        cp -Lr ${generated.nodeDependencies}/lib/node_modules ./node_modules
        cp -L ${./tsconfig.json} ./tsconfig.json
        cp -L ${./index.ts} ./index.ts
        ${pkgs.typescript}/bin/tsc
        touch "$out"
      '';

      lintCheck = pkgs.runCommandLocal "lintCheck" { } ''
        cp -Lr ${./index.ts} ./index.ts
        cp -Lr ${generated.nodeDependencies}/lib/node_modules ./node_modules
        cp -L ${./biome.jsonc} ./biome.jsonc
        cp -L ${./tsconfig.json} ./tsconfig.json
        cp -L ${./package.json} ./package.json
        ${pkgs.biome}/bin/biome check --error-on-warnings
        touch $out
      '';

      packages = {
        formatting = treefmtEval.config.build.check self;
        nodeDependencies = generated.nodeDependencies;
        typecheck = typecheck;
        lintCheck = lintCheck;
        cookie-chromium = pkgs.cookie-chromium;
        default = pkgs.cookie-chromium;
      };

      gcroot = packages // {
        gcroot-all = pkgs.linkFarm "gcroot-all" packages;
      };

    in
    {
      packages.x86_64-linux = gcroot;
      checks.x86_64-linux = gcroot;
      formatter.x86_64-linux = treefmtEval.config.build.wrapper;
      overlays.default = overlay;

      apps.x86_64-linux.fix = {
        type = "app";
        program = lib.getExe updateDependencies;
      };

      apps.x86_64-linux.default = {
        type = "app";
        program = lib.getExe packages.default;
      };

    };
}
