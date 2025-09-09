{
  pkgs ? import <nixpkgs> { },
  ...
}:
let
  lib = pkgs.lib;
  extractTarball =
    src:
    pkgs.runCommand "extracted-${src.name}" { } ''
      mkdir "$out"
      ${pkgs.libarchive}/bin/bsdtar -xf ${src} --strip-components 1 -C "$out"
    '';
  packages = {
    "node_modules/@types/node/" = extractTarball (
      pkgs.fetchurl {
        url = "https://registry.npmjs.org/@types/node/-/node-24.3.1.tgz";
        hash = "sha512-3vXmQDXy+woz+gnrTvuvNrPzekOi+Ds0ReMxw0LzBiK3a+1k0kQn9f2NWk+lgD4rJehFUmYy2gMhJ2ZI+7YP9g==";
      }
    );
    "node_modules/fsevents/" = extractTarball (
      pkgs.fetchurl {
        url = "https://registry.npmjs.org/fsevents/-/fsevents-2.3.2.tgz";
        hash = "sha512-xiqMQR4xAeHTuB9uWm+fFRcIOgKBMiOBP+eXiyT7jsgVCq1bkVygt00oASowB7EdtpOHaaPgKt812P9ab+DDKA==";
      }
    );
    "node_modules/playwright/" = extractTarball (
      pkgs.fetchurl {
        url = "https://registry.npmjs.org/playwright/-/playwright-1.54.1.tgz";
        hash = "sha512-peWpSwIBmSLi6aW2auvrUtf2DqY16YYcCMO8rTVx486jKmDTJg7UAhyrraP98GB8BoPURZP8+nxO7TSd4cPr5g==";
      }
    );
    "node_modules/playwright-core/" = extractTarball (
      pkgs.fetchurl {
        url = "https://registry.npmjs.org/playwright-core/-/playwright-core-1.54.1.tgz";
        hash = "sha512-Nbjs2zjj0htNhzgiy5wu+3w09YetDx5pkrpI/kZotDlDUaYk0HVA5xrBVPdow4SAUIlhgKcJeJg4GRKW6xHusA==";
      }
    );
    "node_modules/undici-types/" = extractTarball (
      pkgs.fetchurl {
        url = "https://registry.npmjs.org/undici-types/-/undici-types-7.10.0.tgz";
        hash = "sha512-t5Fy/nfn+14LuOc2KNYg75vZqClpAiqscVvMygNnlsHBFpSXdJaYtXMcdNLpl/Qvc3P2cB3s6lOV51nqsFq4ag==";
      }
    );
  };
  packageCommands = lib.pipe packages [
    (lib.mapAttrsToList (
      modulePath: package: ''
        mkdir -p "$out/lib/${modulePath}"
        cp -Lr ${package}/* "$out/lib/${modulePath}"
        chmod -R u+w "$out/lib/${modulePath}"
      ''
    ))
    (lib.concatStringsSep "\n")
  ];
in
(pkgs.runCommand "node_modules" { buildInputs = [ pkgs.nodejs ]; } ''
  ${packageCommands}
  mkdir -p "$out/lib/node_modules/.bin"
  patchShebangs --host "$out/lib/node_modules/playwright/cli.js"
  ln -s "$out/lib/node_modules/playwright/cli.js" "$out/lib/node_modules/.bin/playwright"
  patchShebangs --host "$out/lib/node_modules/playwright-core/cli.js"
  ln -s "$out/lib/node_modules/playwright-core/cli.js" "$out/lib/node_modules/.bin/playwright-core"
  ln -s "$out/lib/node_modules/.bin" "$out/bin"
'')
