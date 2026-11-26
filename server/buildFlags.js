// Set by the packaging tool for each customer's download (packaging/build-package.mjs). In this source tree: St. George's defaults,
// so St. George's server and development run every standard module when no license file is installed.
//   REQUIRE_LICENSE  true in customer packages: no license file = core only
//   SGFD_CONTENT     false in packages that don't carry St. George's own forms, evaluation programs and grading
//   PACKAGE          which customer package this is ("" in the source tree)
//   ALLOW_DEV_LICENSE test builds only
export const REQUIRE_LICENSE = false;
export const SGFD_CONTENT = true;
export const PACKAGE = "";
// The download's file name without the version ("fenmorix-os-lgc"), shown on the System page.
export const PACKAGE_NAME = "";
// Test builds only (packaging --test): a customer package that still accepts development licenses. Never shipped.
export const ALLOW_DEV_LICENSE = false;
