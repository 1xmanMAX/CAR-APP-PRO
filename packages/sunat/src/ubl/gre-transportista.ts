import { ID_FIRMA } from "../firma";
import { decimal, escapeXml as x } from "../util";

export type TipoDocIdentidadSunat = "0" | "1" | "4" | "6" | "7";
export interface Parte { tipoDoc: TipoDocIdentidadSunat; numeroDoc: string; razonSocial: string }
export interface Direccion { ubigeo: string; direccion: string }

export interface DatosGreTransportista {
  emisor: { ruc: string; razonSocial: string; registroMtc: string };
  serie: string;
  numero: number;
  fechaEmision: string;
  horaEmision: string;
  fechaTraslado: string;
  remitente: Parte;
  destinatario: Parte;
  partida: Direccion;
  llegada: Direccion;
  pesoBruto: string;
  unidadPeso: "KGM" | "TNE";
  vehiculo: { placa: string; placasSecundarias: string[] };
  conductor: { tipoDoc: TipoDocIdentidadSunat; numeroDoc: string; nombres: string; apellidos: string; licencia: string };
  documentosRelacionados: Array<{ tipo: "01" | "09"; serieNumero: string; rucEmisor: string }>;
  items: Array<{ descripcion: string; cantidad: string; unidadMedida: string }>;
}

const CAT = "urn:pe:gob:sunat:cpe:see:gem:catalogos";
const NOMBRE_DOC: Record<"01" | "09", string> = { "01": "Factura", "09": "Guía de Remisión Remitente" };

function idDoc(tipoDoc: string, numero: string): string {
  return `<cbc:ID schemeID="${x(tipoDoc)}" schemeName="Documento de Identidad" schemeAgencyName="PE:SUNAT" schemeURI="${CAT}:catalogo06">${x(numero)}</cbc:ID>`;
}

function parte(p: Parte): string {
  return `<cac:Party>
      <cac:PartyIdentification>${idDoc(p.tipoDoc, p.numeroDoc)}</cac:PartyIdentification>
      <cac:PartyLegalEntity><cbc:RegistrationName>${x(p.razonSocial)}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>`;
}

function direccion(etiqueta: "DeliveryAddress" | "DespatchAddress", d: Direccion): string {
  return `<cac:${etiqueta}>
        <cbc:ID schemeName="Ubigeos" schemeAgencyName="PE:INEI">${x(d.ubigeo)}</cbc:ID>
        <cac:AddressLine><cbc:Line>${x(d.direccion)}</cbc:Line></cac:AddressLine>
      </cac:${etiqueta}>`;
}

export function normalizarPlaca(placa: string): string {
  return placa.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function construirXmlGreTransportista(d: DatosGreTransportista): string {
  const relacionados = d.documentosRelacionados
    .map(
      (r) => `  <cac:AdditionalDocumentReference>
    <cbc:ID>${x(r.serieNumero)}</cbc:ID>
    <cbc:DocumentTypeCode listAgencyName="PE:SUNAT" listName="Documento relacionado al transporte" listURI="${CAT}:catalogo61">${r.tipo}</cbc:DocumentTypeCode>
    <cbc:DocumentType>${NOMBRE_DOC[r.tipo]}</cbc:DocumentType>
    <cac:IssuerParty><cac:PartyIdentification>${idDoc("6", r.rucEmisor)}</cac:PartyIdentification></cac:IssuerParty>
  </cac:AdditionalDocumentReference>`,
    )
    .join("\n");

  const lineas = d.items
    .map(
      (it, i) => `  <cac:DespatchLine>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:DeliveredQuantity unitCode="${x(it.unidadMedida)}" unitCodeListID="UN/ECE rec 20" unitCodeListAgencyName="United Nations Economic Commission for Europe">${decimal(it.cantidad, 2)}</cbc:DeliveredQuantity>
    <cac:OrderLineReference><cbc:LineID>${i + 1}</cbc:LineID></cac:OrderLineReference>
    <cac:Item>
      <cbc:Description>${x(it.descripcion)}</cbc:Description>
      <cac:AdditionalItemProperty>
        <cbc:Name>Indicador de bien regulado por SUNAT</cbc:Name>
        <cbc:NameCode listAgencyName="PE:SUNAT" listName="Propiedad del item" listURI="${CAT}:catalogo55">7022</cbc:NameCode>
        <cbc:Value>0</cbc:Value>
      </cac:AdditionalItemProperty>
    </cac:Item>
  </cac:DespatchLine>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent/></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID schemeAgencyName="PE:SUNAT">2.0</cbc:CustomizationID>
  <cbc:ID>${x(d.serie)}-${d.numero}</cbc:ID>
  <cbc:IssueDate>${d.fechaEmision}</cbc:IssueDate>
  <cbc:IssueTime>${d.horaEmision}</cbc:IssueTime>
  <cbc:DespatchAdviceTypeCode listAgencyName="PE:SUNAT" listName="Tipo de Documento" listURI="${CAT}:catalogo01">31</cbc:DespatchAdviceTypeCode>
${relacionados}
  <cac:Signature>
    <cbc:ID>${ID_FIRMA}</cbc:ID>
    <cac:SignatoryParty>
      <cac:PartyIdentification><cbc:ID>${x(d.emisor.ruc)}</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>${x(d.emisor.razonSocial)}</cbc:Name></cac:PartyName>
    </cac:SignatoryParty>
    <cac:DigitalSignatureAttachment><cac:ExternalReference><cbc:URI>#${ID_FIRMA}</cbc:URI></cac:ExternalReference></cac:DigitalSignatureAttachment>
  </cac:Signature>
  <cac:DespatchSupplierParty>
    ${parte({ tipoDoc: "6", numeroDoc: d.emisor.ruc, razonSocial: d.emisor.razonSocial })}
  </cac:DespatchSupplierParty>
  <cac:DeliveryCustomerParty>
    ${parte(d.destinatario)}
  </cac:DeliveryCustomerParty>
  <cac:Shipment>
    <cbc:ID>SUNAT_Envio</cbc:ID>
    <cbc:GrossWeightMeasure unitCode="${d.unidadPeso}">${decimal(d.pesoBruto, 3)}</cbc:GrossWeightMeasure>
    <cac:ShipmentStage>
      <cac:TransitPeriod><cbc:StartDate>${d.fechaTraslado}</cbc:StartDate></cac:TransitPeriod>
      <cac:CarrierParty><cac:PartyLegalEntity><cbc:CompanyID>${x(d.emisor.registroMtc)}</cbc:CompanyID></cac:PartyLegalEntity></cac:CarrierParty>
      <cac:DriverPerson>
        ${idDoc(d.conductor.tipoDoc, d.conductor.numeroDoc)}
        <cbc:FirstName>${x(d.conductor.nombres)}</cbc:FirstName>
        <cbc:FamilyName>${x(d.conductor.apellidos)}</cbc:FamilyName>
        <cbc:JobTitle>Principal</cbc:JobTitle>
        <cac:IdentityDocumentReference><cbc:ID>${x(d.conductor.licencia)}</cbc:ID></cac:IdentityDocumentReference>
      </cac:DriverPerson>
    </cac:ShipmentStage>
    <cac:Delivery>
      ${direccion("DeliveryAddress", d.llegada)}
      <cac:Despatch>
        ${direccion("DespatchAddress", d.partida)}
        <cac:DespatchParty>
          <cac:PartyIdentification>${idDoc(d.remitente.tipoDoc, d.remitente.numeroDoc)}</cac:PartyIdentification>
          <cac:PartyLegalEntity><cbc:RegistrationName>${x(d.remitente.razonSocial)}</cbc:RegistrationName></cac:PartyLegalEntity>
        </cac:DespatchParty>
      </cac:Despatch>
    </cac:Delivery>
    <cac:TransportHandlingUnit>
      <cac:TransportEquipment><cbc:ID>${x(normalizarPlaca(d.vehiculo.placa))}</cbc:ID>${d.vehiculo.placasSecundarias
        .map((p) => `<cac:AttachedTransportEquipment><cbc:ID>${x(normalizarPlaca(p))}</cbc:ID></cac:AttachedTransportEquipment>`)
        .join("")}</cac:TransportEquipment>
    </cac:TransportHandlingUnit>
  </cac:Shipment>
${lineas}
</DespatchAdvice>`;
}
