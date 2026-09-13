import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";

export interface Certificado {
  privateKeyPem: string;
  certificatePem: string;
  certificadoBase64: string;
  subject: string;
  validoDesde: Date;
  validoHasta: Date;
}

function pemABase64(pem: string): string {
  return pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
}

export function cargarPfx(pfx: Buffer, password: string): Certificado {
  const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary")));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
  // Los oids de forge están tipados como Record<string, string | undefined>; son constantes
  // conocidas de la librería, así que se afirman como string antes de usarlos como clave.
  const oidClave = forge.pki.oids.pkcs8ShroudedKeyBag as string;
  const oidCert = forge.pki.oids.certBag as string;
  const bolsaClave = p12.getBags({ bagType: oidClave })[oidClave];
  const clave = bolsaClave?.[0]?.key;
  if (!clave) throw new Error("El certificado no tiene clave privada (¿contraseña incorrecta?)");
  const bolsaCert = p12.getBags({ bagType: oidCert })[oidCert];
  const cert = bolsaCert?.[0]?.cert;
  if (!cert) throw new Error("El archivo no contiene certificado");
  const certificatePem = forge.pki.certificateToPem(cert);
  return {
    privateKeyPem: forge.pki.privateKeyToPem(clave),
    certificatePem,
    certificadoBase64: pemABase64(certificatePem),
    subject: cert.subject.attributes.map((a) => `${a.shortName}=${a.value}`).join(", "),
    validoDesde: cert.validity.notBefore,
    validoHasta: cert.validity.notAfter,
  };
}

export function generarCertificadoPrueba(o: { ruc: string; razonSocial: string; password: string }): Buffer {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const clavePrivada = forge.pki.privateKeyFromPem(privateKey);
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(publicKey);
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + 2 * 365 * 24 * 3600 * 1000);
  const atributos = [
    { name: "commonName", value: `${o.razonSocial} - CERTIFICADO DE PRUEBA` },
    { name: "organizationName", value: o.razonSocial },
    { name: "organizationalUnitName", value: `RUC ${o.ruc}` },
    { shortName: "C", value: "PE" },
  ];
  cert.setSubject(atributos);
  cert.setIssuer(atributos);
  cert.sign(clavePrivada, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(clavePrivada, [cert], o.password, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary");
}
