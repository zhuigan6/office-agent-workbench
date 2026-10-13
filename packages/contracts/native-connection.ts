const safeCodes=new Set(['ECONNREFUSED','ECONNRESET','ENOTFOUND','EHOSTUNREACH','ETIMEDOUT','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID','NATIVE_DOCUMENT_TIMEOUT','NATIVE_DOCUMENT_RESPONSE_LIMIT']);
export function nativeConnectionFailure(error:unknown){
  const raw=error&&typeof error==='object'?(error as {code?:unknown}).code:undefined;
  const code=typeof raw==='string'&&safeCodes.has(raw)?raw:'CONNECTION';
  return `Document connection failed (${code}); inspect current operation before retrying. No automatic replay was attempted.`;
}
