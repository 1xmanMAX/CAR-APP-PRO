import { sql, type Ejecutor } from "@sunatapp/db";
import { filas } from "./registro";

/**
 * **Lo que se recalcula después de sincronizar.** Hay valores que cada dispositivo guarda ya hechos
 * (el stock de un repuesto, el odómetro de una unidad) y que dos dispositivos pudieron mover a la vez:
 * si se juntaran campo por campo, dos compras hechas en dos celulares sumarían solo una. Por eso se
 * vuelven a sacar de los movimientos, que sí viajan todos. Los dos dispositivos llegan al mismo valor.
 */
export async function recalcularDerivados(db: Ejecutor): Promise<string[]> {
  const avisos: string[] = [];
  const ejecutar = async (tx: Ejecutor) => {
    await tx.execute(sql`select set_config('sinc.aplicando', 'si', true)`);
    // Stock = compras − lo usado en reparaciones; costo = promedio ponderado de las compras.
    await tx.execute(sql`
      update repuesto r set
        stock = coalesce(c.cant, 0) - coalesce(u.cant, 0),
        costo_unitario = case when coalesce(c.cant, 0) > 0 then round(c.total::numeric / c.cant)::bigint else r.costo_unitario end
      from repuesto r2
      left join (select repuesto_id, sum(cantidad) as cant, sum(cantidad * costo_unitario) as total from compra_repuesto group by repuesto_id) c on c.repuesto_id = r2.id
      left join (select repuesto_id, sum(cantidad) as cant from reparacion_repuesto group by repuesto_id) u on u.repuesto_id = r2.id
      where r.id = r2.id and (c.cant is not null or u.cant is not null)`);
    // El odómetro nunca retrocede: el mayor entre el guardado y todas las lecturas.
    await tx.execute(sql`
      update vehiculo v set odometro_km = l.km
      from (select vehiculo_id, max(km) as km from lectura_odometro group by vehiculo_id) l
      where l.vehiculo_id = v.id and l.km > v.odometro_km`);
    // Una sola parte activa por unidad, tipo y posición: la instalada más tarde.
    const dobles = filas<{ id: number; fecha: string }>(await tx.execute(sql`
      select p.id, n.fecha from parte_instalada p
      join (select vehiculo_id, tipo_parte_id, posicion, max(fecha_instalacion) as fecha
            from parte_instalada where activa group by vehiculo_id, tipo_parte_id, posicion having count(*) > 1) n
        on n.vehiculo_id = p.vehiculo_id and n.tipo_parte_id = p.tipo_parte_id and n.posicion = p.posicion
      where p.activa and p.id <> (
        select id from parte_instalada q where q.activa and q.vehiculo_id = p.vehiculo_id and q.tipo_parte_id = p.tipo_parte_id
          and q.posicion = p.posicion order by q.fecha_instalacion desc, q.sinc_creado desc, q.sinc_uid desc limit 1)`));
    for (const d of dobles) {
      await tx.execute(sql`update parte_instalada set activa = false, retirada_en = ${d.fecha} where id = ${d.id}`);
    }
    if (dobles.length) avisos.push(`${dobles.length} parte(s) instaladas dos veces en distintos dispositivos: queda la más reciente`);
    // Correlativos: que el próximo número no repita uno que ya llegó de otro dispositivo.
    await tx.execute(sql`
      insert into correlativo (tipo_documento, serie, ultimo_numero)
      select 'VJ', 'VJ', max((regexp_match(codigo, '^VJ-(\\d+)'))[1]::int) from viaje where codigo ~ '^VJ-\\d+'
      having count(*) > 0
      on conflict (tipo_documento, serie) do update set ultimo_numero = greatest(correlativo.ultimo_numero, excluded.ultimo_numero)`);
    await tx.execute(sql`
      insert into correlativo (tipo_documento, serie, ultimo_numero)
      select '31', serie, max(numero) from guia_transportista where numero is not null group by serie
      on conflict (tipo_documento, serie) do update set ultimo_numero = greatest(correlativo.ultimo_numero, excluded.ultimo_numero)`);
    await tx.execute(sql`
      insert into correlativo (tipo_documento, serie, ultimo_numero)
      select '01', serie, max(numero) from factura where numero is not null group by serie
      on conflict (tipo_documento, serie) do update set ultimo_numero = greatest(correlativo.ultimo_numero, excluded.ultimo_numero)`);
    const enCurso = filas<{ codigo: string; n: number }>(await tx.execute(sql`
      select v.codigo, count(*)::int as n from viaje j join vehiculo v on v.id = j.vehiculo_id
      where j.estado = 'en_curso' group by v.codigo having count(*) > 1`));
    for (const e of enCurso) avisos.push(`${e.codigo} tiene ${e.n} viajes en curso abiertos desde distintos dispositivos: cierra los que sobran`);
  };
  if ("transaction" in db) await (db as { transaction: (f: (tx: Ejecutor) => Promise<void>) => Promise<void> }).transaction(ejecutar);
  else await ejecutar(db);
  return avisos;
}
