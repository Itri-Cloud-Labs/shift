// electron-builder's configuration for one build, from the base in package.json and whether this
// platform's build is signed (`null` on Linux, whose packages are not signed).
export function builderConfig(base, signed) {
  const suffix = signed === false ? '-unsigned' : '';
  // The base disables signing (`identity: null`); a signed build removes that override so
  // electron-builder signs with the certificate from CSC_LINK, then notarizes.
  const { identity: _identity, ...mac } = base.mac;
  return {
    ...base,
    artifactName: `Shift-\${version}-\${os}-\${arch}${suffix}.\${ext}`,
    mac: signed ? { ...mac, notarize: true, hardenedRuntime: true } : { ...mac, identity: null },
    win: { ...base.win, signAndEditExecutable: Boolean(signed) },
  };
}
