import assert from "node:assert/strict";
import test from "node:test";
import { buildAuthRedirect } from "../public/auth-redirects.js";

test("builds same-origin Azure authentication return URLs", () => {
  assert.equal(
    buildAuthRedirect(
      "/.auth/login/github",
      "post_login_redirect_uri",
      "/",
      "https://calm-stone-123.azurestaticapps.net",
    ),
    "/.auth/login/github?post_login_redirect_uri=https%3A%2F%2Fcalm-stone-123.azurestaticapps.net%2F",
  );
  assert.equal(
    buildAuthRedirect(
      "/.auth/logout",
      "post_logout_redirect_uri",
      "/login",
      "https://stk.aserdargun.com",
    ),
    "/.auth/logout?post_logout_redirect_uri=https%3A%2F%2Fstk.aserdargun.com%2Flogin",
  );
});
