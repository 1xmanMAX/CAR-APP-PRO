import { createHash, createSign, createVerify, X509Certificate } from "node:crypto";
import { DOMParser, XMLSerializer, type Document, type Element, type Node } from "@xmldom/xmldom";
import { C14nCanonicalization } from "xml-crypto";
import type { Certificado } from "./certificado";

export const ID_FIRMA = "SignSUNATAPP";

const DS = "http://www.w3.org/2000/09/xmldsig#";
const EXT = "urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2";
const C14N = "http://www.w3.org/TR/2001/REC-xml-c14n-20010315";
const c14n = new C14nCanonicalization();

type Ns = { prefix: string; namespaceURI: string };

function parsear(xml: string): Document {
  return new DOMParser().parseFromString(xml, "text/xml");
}

function serializar(doc: Document | Node): string {
  return new XMLSerializer().serializeToString(doc);
}

function canonicalizar(nodo: Node, ancestros: Ns[] = []): string {
  return c14n.process(nodo as never, { ancestorNamespaces: ancestros }) as string;
}

function namespacesAncestros(nodo: Element): Ns[] {
  const lista: Ns[] = [];
  const vistos = new Set<string>();
  let actual = nodo.parentNode;
  while (actual && actual.nodeType === 1) {
    const el = actual as Element;
    for (let i = 0; i < el.attributes.length; i++) {
      const attr = el.attributes.item(i)!;
      if (attr.name === "xmlns" || attr.name.startsWith("xmlns:")) {
        const prefix = attr.name === "xmlns" ? "" : attr.name.slice(6);
        if (!vistos.has(prefix)) {
          vistos.add(prefix);
          lista.push({ prefix, namespaceURI: attr.value });
        }
      }
    }
    actual = actual.parentNode;
  }
  return lista;
}

function digestSinFirma(doc: Document): string {
  const copia = parsear(serializar(doc));
  const firma = copia.getElementsByTagNameNS(DS, "Signature").item(0);
  firma?.parentNode?.removeChild(firma);
  return createHash("sha256").update(canonicalizar(copia.documentElement!), "utf8").digest("base64");
}

function hijo(doc: Document, padre: Element, nombre: string, atributos: Record<string, string> = {}, texto?: string): Element {
  const el = doc.createElementNS(DS, `ds:${nombre}`);
  for (const [k, v] of Object.entries(atributos)) el.setAttribute(k, v);
  if (texto !== undefined) el.appendChild(doc.createTextNode(texto));
  padre.appendChild(el);
  return el;
}

export function firmarXml(xmlSinFirma: string, cert: Certificado): string {
  const doc = parsear(xmlSinFirma);
  const contenido = doc.getElementsByTagNameNS(EXT, "ExtensionContent").item(0);
  if (!contenido) throw new Error("El XML no tiene el nodo ext:ExtensionContent");
  while (contenido.firstChild) contenido.removeChild(contenido.firstChild);

  const firma = doc.createElementNS(DS, "ds:Signature");
  firma.setAttribute("Id", ID_FIRMA);
  contenido.appendChild(firma);
  const signedInfo = hijo(doc, firma, "SignedInfo");
  hijo(doc, signedInfo, "CanonicalizationMethod", { Algorithm: C14N });
  hijo(doc, signedInfo, "SignatureMethod", { Algorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256" });
  const referencia = hijo(doc, signedInfo, "Reference", { URI: "" });
  const transforms = hijo(doc, referencia, "Transforms");
  hijo(doc, transforms, "Transform", { Algorithm: "http://www.w3.org/2000/09/xmldsig#enveloped-signature" });
  hijo(doc, referencia, "DigestMethod", { Algorithm: "http://www.w3.org/2001/04/xmlenc#sha256" });
  hijo(doc, referencia, "DigestValue", {}, digestSinFirma(doc));
  hijo(doc, firma, "SignatureValue");
  const keyInfo = hijo(doc, firma, "KeyInfo");
  const x509Data = hijo(doc, keyInfo, "X509Data");
  hijo(doc, x509Data, "X509Certificate", {}, cert.certificadoBase64);

  // Reparsear para firmar exactamente el mismo DOM que verá el receptor.
  const doc2 = parsear(serializar(doc));
  const firma2 = doc2.getElementsByTagNameNS(DS, "Signature").item(0)!;
  const signedInfo2 = firma2.getElementsByTagNameNS(DS, "SignedInfo").item(0)!;
  const valor = createSign("RSA-SHA256")
    .update(canonicalizar(signedInfo2, namespacesAncestros(signedInfo2)), "utf8")
    .sign(cert.privateKeyPem, "base64");
  firma2.getElementsByTagNameNS(DS, "SignatureValue").item(0)!.appendChild(doc2.createTextNode(valor));

  const salida = serializar(doc2);
  return salida.startsWith("<?xml") ? salida : `<?xml version="1.0" encoding="UTF-8"?>\n${salida}`;
}

function textoDs(padre: Element, nombre: string): string {
  return padre.getElementsByTagNameNS(DS, nombre).item(0)?.textContent?.trim() ?? "";
}

export function verificarFirma(xml: string): { valida: boolean; motivo?: "sin_firma" | "digest" | "firma" } {
  const doc = parsear(xml);
  const firma = doc.getElementsByTagNameNS(DS, "Signature").item(0);
  if (!firma) return { valida: false, motivo: "sin_firma" };
  if (digestSinFirma(doc) !== textoDs(firma, "DigestValue")) return { valida: false, motivo: "digest" };
  const signedInfo = firma.getElementsByTagNameNS(DS, "SignedInfo").item(0)!;
  const lineas = textoDs(firma, "X509Certificate").match(/.{1,64}/g) ?? [];
  const pem = `-----BEGIN CERTIFICATE-----\n${lineas.join("\n")}\n-----END CERTIFICATE-----\n`;
  const ok = createVerify("RSA-SHA256")
    .update(canonicalizar(signedInfo, namespacesAncestros(signedInfo)), "utf8")
    .verify(new X509Certificate(pem).publicKey, textoDs(firma, "SignatureValue"), "base64");
  return ok ? { valida: true } : { valida: false, motivo: "firma" };
}

export function extraerDigest(xml: string): string {
  const firma = parsear(xml).getElementsByTagNameNS(DS, "Signature").item(0);
  if (!firma) throw new Error("El XML no está firmado");
  return textoDs(firma, "DigestValue");
}
