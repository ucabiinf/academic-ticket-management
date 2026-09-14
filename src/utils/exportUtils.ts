import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';

async function fetchAllObservaciones() {
  const PAGE_SIZE = 1000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let allData: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('observacion')
      .select(`
        obs_id,
        obs_estatus,
        obs_clasificacion,
        obs_num_caso,
        obs_fecha,
        obs_autoriza,
        obs_accion,
        obs_nrc_solicitado,
        obs_comentarios,
        obs_responsable,
        obs_respuesta_interna,
        obs_respuesta_externa,
        estudiante (
          est_cedula,
          est_nombre,
          est_ubic_sem,
          est_promedio,
          est_creditos_acum,
          est_correo
        ),
        materia (
          mat_nombre
        )
      `)
      .order('obs_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;

    allData = allData.concat(data || []);

    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return allData;
}

export const exportObservationsToExcel = async () => {
  // Fetch ALL data from the normalized tables with joins (paginado para superar el límite de 1000 filas de PostgREST)
  const data = await fetchAllObservaciones();

  if (!data || data.length === 0) {
    return 0; // Return 0 gracefully instead of throwing an error
  }

  // Flatten data for Excel export
  const flattenedData = data.map((row: any) => ({
    'ID': row.obs_id,
    'Estatus': row.obs_estatus,
    'Clasificación': row.obs_clasificacion,
    '# de Caso': row.obs_num_caso,
    'Fecha': row.obs_fecha,
    'Cédula': row.estudiante?.est_cedula,
    'Estudiante': row.estudiante?.est_nombre,
    'Semestre': row.estudiante?.est_ubic_sem,
    'Promedio': row.estudiante?.est_promedio,
    'Créditos': row.estudiante?.est_creditos_acum,
    'Materia': row.materia?.mat_nombre,
    'Acción': row.obs_accion,
    'NRC': row.obs_nrc_solicitado,
    'Autoriza': row.obs_autoriza,
    'Comentarios': row.obs_comentarios,
    'Contacto': row.estudiante?.est_correo,
    'Responsable': row.obs_responsable,
    'Respuesta Interna': row.obs_respuesta_interna,
    'Respuesta Estudiante': row.obs_respuesta_externa
  }));

  // Create workbook and worksheet
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(flattenedData);

  // Enable autofilter to make it behave like an Excel table
  if (ws['!ref']) {
    ws['!autofilter'] = { ref: ws['!ref'] };
  }

  // Add worksheet to workbook
  XLSX.utils.book_append_sheet(wb, ws, 'Observaciones');

  // Generate filename with current date
  const date = new Date().toISOString().split('T')[0];
  const filename = `observaciones_${date}.xlsx`;

  // Download the file
  XLSX.writeFile(wb, filename);

  return data.length;
};
