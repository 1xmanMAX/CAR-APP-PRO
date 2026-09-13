import type { DocumentoFirmado, RespuestaSunat, SunatGateway } from "./tipos";

export class SunatMixto implements SunatGateway {
  constructor(private readonly guias: SunatGateway, private readonly facturas: SunatGateway) {}

  enviarGuia(doc: DocumentoFirmado): Promise<{ ticket: string }> {
    return this.guias.enviarGuia(doc);
  }

  consultarTicket(ticket: string): Promise<RespuestaSunat> {
    return this.guias.consultarTicket(ticket);
  }

  enviarFactura(doc: DocumentoFirmado): Promise<RespuestaSunat> {
    return this.facturas.enviarFactura(doc);
  }
}
