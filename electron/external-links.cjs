const HF_PROFILE_PATH = /^\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/?$/;

function allowedExternalUrl(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;

    if (url.hostname === "huggingface.co") {
      if (url.search) return false;
      return url.pathname === "/settings/tokens"
        || url.pathname.startsWith("/datasets/")
        || HF_PROFILE_PATH.test(url.pathname);
    }

    if (url.hostname === "www.google.com" && url.pathname === "/search") {
      const keys = [...url.searchParams.keys()];
      const query = url.searchParams.get("q") || "";
      return keys.length === 1 && keys[0] === "q" && query.length > 0 && query.length <= 320;
    }

    return false;
  } catch {
    return false;
  }
}

module.exports = { allowedExternalUrl };
