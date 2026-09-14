import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import type { Request, Status } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { RESPONSES_BY_CATEGORY } from '../data/predefinedResponses';
import { DEPARTMENT_COLORS, DEPARTMENT_NAMES } from '../constants/departments';
import { useRealtimeLock } from '../hooks/useRealtimeLock';
import { LockedBanner } from './LockedBanner';
import { SuccessModal } from './SuccessModal';
import { StudentFilters } from './StudentFilters';

export const RequestsView: React.FC = () => {

  const [requests, setRequests] = useState<Request[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRequest, setSelectedRequest] = useState<Request | null>(null);

  // Filter state
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>('POR REVISAR');
  const [selectedSubject, setSelectedSubject] = useState<string>('All');
  const [selectedAction, setSelectedAction] = useState<string>('All');
  const [selectedResponsible, setSelectedResponsible] = useState<string>('All');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  // Export to Excel function
  const exportToExcel = async () => {
    setExporting(true);
    try {
      const { exportObservationsToExcel } = await import('../utils/exportUtils');
      const count = await exportObservationsToExcel();
      alert(`Archivo descargado exitosamente con ${count} registros.`);
    } catch (err: any) {
      console.error('Error exporting to Excel:', err);
      alert(err.message || 'Error al exportar los datos');
    } finally {
      setExporting(false);
    }
  };


  const fetchAllObservaciones = async () => {
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
  };

  const fetchRequests = async () => {
    try {
      // Fetch from normalized tables with joins (paginado para superar el límite de 1000 filas de PostgREST)
      const data = await fetchAllObservaciones();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const formattedRequests: Request[] = (data || []).map((row: any) => ({
        id: row.obs_id,
        status: row.obs_estatus,
        classification: row.obs_clasificacion,
        caseId: row.obs_num_caso,
        date: row.obs_fecha,
        studentId: row.estudiante?.est_cedula?.toString() || '',
        studentName: row.estudiante?.est_nombre || 'Desconocido',
        credits: row.estudiante?.est_creditos_acum || 0,
        semester: row.estudiante?.est_ubic_sem || '',
        gpa: row.estudiante?.est_promedio || 0,
        authorized: row.obs_autoriza,
        action: row.obs_accion || '',
        subject: row.materia?.mat_nombre || '',
        nrc: row.obs_nrc_solicitado || 0,
        comments: row.obs_comentarios || '',
        contact: row.estudiante?.est_correo || '',
        responsible: row.obs_responsable || '',
        internalResponse: row.obs_respuesta_interna || '',
        studentResponse: row.obs_respuesta_externa || ''
      }));

      // Sort by caseId (obs_num_caso) ascending
      formattedRequests.sort((a, b) => (a.caseId || '').localeCompare(b.caseId || ''));

      setRequests(formattedRequests);
    } catch (err) {
      console.error('Error fetching requests:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();

    // Subscribe to realtime updates for the observacion table
    const channel = supabase
      .channel('requests-list-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'observacion'
        },
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            await fetchRequests();
          } else if (payload.eventType === 'UPDATE') {
            const updatedRow = payload.new as any;
            setRequests(prev => prev.map(req => {
              if (req.id === updatedRow.obs_id) {
                return {
                  ...req,
                  status: updatedRow.obs_estatus as Status,
                  responsible: updatedRow.obs_responsable || '',
                  classification: updatedRow.obs_clasificacion || req.classification,
                  action: updatedRow.obs_accion || req.action,
                  internalResponse: updatedRow.obs_respuesta_interna || req.internalResponse,
                  studentResponse: updatedRow.obs_respuesta_externa || req.studentResponse
                };
              }
              return req;
            }));

            setSelectedRequest(prev => {
              if (prev && prev.id === updatedRow.obs_id) {
                return {
                  ...prev,
                  status: updatedRow.obs_estatus as Status,
                  responsible: updatedRow.obs_responsable || '',
                  classification: updatedRow.obs_clasificacion || prev.classification,
                  action: updatedRow.obs_accion || prev.action,
                  internalResponse: updatedRow.obs_respuesta_interna || prev.internalResponse,
                  studentResponse: updatedRow.obs_respuesta_externa || prev.studentResponse
                };
              }
              return prev;
            });
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as any).obs_id;
            setRequests(prev => prev.filter(req => req.id !== deletedId));
            setSelectedRequest(prev => (prev?.id === deletedId ? null : prev));
          }
        }
      )
      .subscribe();

    // Cleanup subscription on unmount
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Unique subjects for filter
  const subjects = useMemo(() => {
    return Array.from(new Set(requests.map(r => r.subject).filter(Boolean)));
  }, [requests]);
 
  // Unique responsibles for filter
  const responsibles = useMemo(() => {
    return Array.from(new Set(requests.map(r => r.responsible).filter(Boolean)));
  }, [requests]);

  const filteredRequests = useMemo(() => {
    return requests.filter(r => {
      // Search term
      if (searchTerm) {
        const lowerSearch = searchTerm.toLowerCase();
        const matchesSearch =
          r.studentName.toLowerCase().includes(lowerSearch) ||
          r.studentId.includes(lowerSearch) ||
          r.subject.toLowerCase().includes(lowerSearch) ||
          r.caseId?.toString().includes(lowerSearch);

        if (!matchesSearch) return false;
      }

      // Dept filter
      if (selectedDepts.length > 0 && !selectedDepts.includes(r.classification)) {
        return false;
      }

      // Status filter
      if (selectedStatus !== 'All' && r.status !== selectedStatus) {
        return false;
      }

      // Subject filter
      if (selectedSubject !== 'All' && r.subject !== selectedSubject) {
        return false;
      }

      // Action filter
      if (selectedAction !== 'All' && r.action !== selectedAction) {
        return false;
      }

      // Responsible filter
      if (selectedResponsible !== 'All' && r.responsible !== selectedResponsible) {
        return false;
      }

      return true;
    });
  }, [requests, searchTerm, selectedDepts, selectedStatus, selectedSubject, selectedAction, selectedResponsible]);

  // Pagination logic
  const totalPages = Math.ceil(filteredRequests.length / pageSize);
  const startIndex = (currentPage - 1) * pageSize;
  const currentRequests = filteredRequests.slice(startIndex, startIndex + pageSize);

  // Pre-compute grouping info for current page to avoid calculation in render
  const groupingInfo = useMemo(() => {
    const getBaseId = (id: string) => id?.split('-')[0] || '';
    return currentRequests.map((req, index) => {
      const currentBase = getBaseId(req.caseId);
      const prevBase = index > 0 ? getBaseId(currentRequests[index - 1].caseId) : null;
      const nextBase = index < currentRequests.length - 1 ? getBaseId(currentRequests[index + 1].caseId) : null;

      const isPartOfGroup = (currentBase === prevBase) || (currentBase === nextBase);
      const isFirstInGroup = isPartOfGroup && (currentBase !== prevBase);
      const isLastInGroup = isPartOfGroup && (currentBase !== nextBase);

      return { isPartOfGroup, isFirstInGroup, isLastInGroup };
    });
  }, [currentRequests]);

  // Pre-format dates for current page
  const formattedDates = useMemo(() => {
    const cache: Record<string, string> = {};
    return currentRequests.map(req => {
      if (!cache[req.date]) {
        try {
          const date = new Date(req.date);
          cache[req.date] = new Intl.DateTimeFormat('es-VE', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }).format(date);
        } catch (e) {
          cache[req.date] = req.date;
        }
      }
      return cache[req.date];
    });
  }, [currentRequests]);


  const handleDeptToggle = (deptId: string) => {
    setSelectedDepts(prev =>
      prev.includes(deptId) ? prev.filter(id => id !== deptId) : [...prev, deptId]
    );
    setCurrentPage(1);
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden bg-background-light dark:bg-background-dark">
      {/* Sidebar Filters */}
      <StudentFilters
        selectedDepts={selectedDepts}
        onDeptChange={handleDeptToggle}
        selectedStatus={selectedStatus}
        onStatusChange={setSelectedStatus}
        selectedSubject={selectedSubject}
        onSubjectChange={setSelectedSubject}
        subjects={subjects}
        selectedResponsible={selectedResponsible}
        onResponsibleChange={setSelectedResponsible}
        responsibles={responsibles}
        selectedAction={selectedAction}
        onActionChange={setSelectedAction}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col p-6 lg:p-8 overflow-hidden">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8 animate-fadeInUp">
          <div>
            <h1 className="text-[#0d141b] dark:text-white text-3xl font-black leading-tight tracking-tight mb-1">Solicitudes de Inscripción</h1>
            <p className="text-slate-500 dark:text-slate-400 font-medium text-sm flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
              Monitoreo en tiempo real de trámites académicos
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative w-full md:w-80">
              <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">search</span>
              <input
                type="text"
                placeholder="Buscar por estudiante, C.I., materia..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all shadow-sm text-sm"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
              />
            </div>
            <button
              onClick={exportToExcel}
              disabled={exporting}
              className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm transition-all shadow-md shadow-emerald-500/10 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[20px]">download</span>
              {exporting ? 'Exportando...' : 'Excel'}
            </button>
          </div>
        </div>

        {/* Results Info Bar */}
        {(selectedDepts.length > 0 || selectedStatus !== 'All' || selectedSubject !== 'All' || selectedAction !== 'All' || selectedResponsible !== 'All' || searchTerm.trim() !== '') && (
          <div className="mb-4 flex items-center justify-between bg-white dark:bg-slate-900 rounded-xl px-4 py-3 border border-slate-200 dark:border-slate-800 shadow-sm animate-fadeInUp" style={{ animationDelay: '100ms', opacity: 0 }}>
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-primary text-xl">manage_search</span>
              <span className="text-sm text-slate-600 dark:text-slate-400">
                Filtrando solicitudes: <span className="font-bold text-slate-900 dark:text-white">{filteredRequests.length}</span> resultados encontrados
              </span>
            </div>
            <button
              onClick={() => {
                setSelectedDepts([]);
                setSelectedStatus('All');
                setSelectedSubject('All');
                setSelectedAction('All');
                setSelectedResponsible('All');
                setSearchTerm('');
                setCurrentPage(1);
              }}
              className="flex items-center gap-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
            >
              <span className="material-symbols-outlined text-sm">filter_alt_off</span>
              Limpiar filtros
            </button>
          </div>
        )}

        {/* Table Container */}
        <div className="flex-1 bg-white dark:bg-surface-dark rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden flex flex-col animate-fadeInUp" style={{ animationDelay: '100ms', opacity: 0 }}>
          <div className="overflow-x-auto h-full custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 text-[11px] uppercase font-bold tracking-wider sticky top-0 z-10 backdrop-blur-sm border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3 whitespace-nowrap">Caso / Fecha</th>
                  <th className="px-4 py-3">Estudiante</th>
                  <th className="px-4 py-3">Materia</th>
                  <th className="px-4 py-3 whitespace-nowrap">Acción</th>
                  <th className="px-4 py-3 whitespace-nowrap">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {currentRequests.map((req, index) => {
                  const { isPartOfGroup, isFirstInGroup, isLastInGroup } = groupingInfo[index];
                  const isInReview = req.status === 'EN REVISIÓN';

                  return (
                    <tr
                      key={req.id}
                      onClick={() => setSelectedRequest(req)}
                      className={`group hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer animate-fadeInUp ${isInReview ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}`}
                      style={{ animationDelay: `${index * 40}ms`, opacity: 0 }}
                    >
                      <td className={`pl-8 pr-3 py-3 whitespace-nowrap relative ${isInReview ? 'border-l-4 border-amber-400' : ''}`}>
                        {/* Department Visual Hint */}
                        <div
                          className="absolute left-0 top-0 bottom-0 w-1 opacity-60 group-hover:opacity-100 transition-opacity"
                          style={{ backgroundColor: DEPARTMENT_COLORS[req.classification] || 'transparent' }}
                          title={DEPARTMENT_NAMES[req.classification]}
                        />
                        {/* Visual Connection Line */}
                        {isPartOfGroup && (
                          <div className="absolute left-3 top-0 bottom-0 flex flex-col items-center">
                            <div className={`w-[2px] bg-primary/30 dark:bg-primary/20 grow ${isFirstInGroup ? 'invisible' : ''}`} />
                            <div className="w-2 h-2 rounded-full border-2 border-primary bg-white dark:bg-slate-900 z-10 my-0.5" />
                            <div className={`w-[2px] bg-primary/30 dark:bg-primary/20 grow ${isLastInGroup ? 'invisible' : ''}`} />
                          </div>
                        )}

                        <div className="text-[10px] text-slate-400 font-mono mb-0.5">#{req.caseId}</div>
                        <div className="text-[10px] font-medium text-slate-500 dark:text-slate-400 italic">{formattedDates[index]}</div>
                        {isInReview && req.responsible && (
                          <div className="mt-0.5 flex items-center gap-1 text-[9px] font-bold text-amber-700 dark:text-amber-400">
                            <span className="material-symbols-outlined text-[10px]">person</span>
                            {req.responsible}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-[180px]">{req.studentName}</div>
                        <div className="text-[11px] text-slate-500">C.I.: {req.studentId}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-slate-700 dark:text-slate-300 font-medium truncate max-w-[200px]">{req.subject}</div>
                        <div className="text-[11px] text-slate-500">NRC: {req.nrc === 0 ? 'sin nrc sugerido' : req.nrc}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                          {req.action || 'S/A'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={req.status} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filteredRequests.length === 0 && (
              <div className="flex flex-col items-center justify-center p-20 text-slate-400">
                <span className="material-symbols-outlined text-6xl mb-4">search_off</span>
                <p className="text-lg font-bold">No se encontraron solicitudes</p>
                <p className="text-sm">Prueba ajustando los filtros de búsqueda</p>
              </div>
            )}
          </div>

          {/* Pagination */}
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/10 mt-auto">
            <span className="text-sm text-slate-500 font-medium">
              Mostrando <span className="text-slate-900 dark:text-white font-bold">{filteredRequests.length > 0 ? startIndex + 1 : 0}</span>-
              <span className="text-slate-900 dark:text-white font-bold">{Math.min(startIndex + pageSize, filteredRequests.length)}</span> de
              <span className="text-slate-900 dark:text-white font-bold ml-1">{filteredRequests.length}</span>
            </span>
            <div className="flex gap-2">
              <button
                disabled={currentPage === 1}
                onClick={(e) => { e.stopPropagation(); setCurrentPage(p => p - 1); }}
                className="p-1 px-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-30 text-sm font-bold transition-all shadow-sm"
              >
                Anterior
              </button>
              <div className="flex items-center px-4 text-sm font-black text-primary">
                {currentPage} / {totalPages || 1}
              </div>
              <button
                disabled={currentPage === totalPages || totalPages === 0}
                onClick={(e) => { e.stopPropagation(); setCurrentPage(p => p + 1); }}
                className="p-1 px-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-30 text-sm font-bold transition-all shadow-sm"
              >
                Siguiente
              </button>
            </div>
          </div>
        </div>

        {
          selectedRequest && (
            <RequestDetailModal
              request={selectedRequest!}
              allRequests={requests}
              onClose={() => setSelectedRequest(null)}
              onUpdate={(updatedReq) => {
                setRequests(prev => prev.map(r => r.id === updatedReq.id ? updatedReq : r));
              }}
            />
          )
        }
      </div>
    </div >
  );
};

const StatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const getColors = () => {
    switch (status) {
      case 'POR REVISAR': return 'bg-amber-100 text-amber-700 border-amber-200';
      case 'EN REVISIÓN': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'SOLUCIONADO': return 'bg-green-100 text-green-700 border-green-200';
      case 'NO PROCEDE': return 'bg-rose-100 text-rose-700 border-rose-200';
      case 'IGNORADO': return 'bg-slate-100 text-slate-600 border-slate-200';
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  return (
    <span className={`px-2 py-1 rounded text-[10px] font-bold border ${getColors()}`}>
      {status}
    </span>
  );
};

interface DetailModalProps {
  request: Request;
  allRequests: Request[];
  onClose: () => void;
  onUpdate: (request: Request) => void;
}

const RequestDetailModal: React.FC<DetailModalProps> = ({ request, allRequests, onClose, onUpdate }) => {
  const { profile } = useAuth();
  const [status, setStatus] = useState<Status>(request.status);
  const [internalResponse, setInternalResponse] = useState(request.internalResponse);
  const [studentResponse, setStudentResponse] = useState(request.studentResponse);
  const [saving, setSaving] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);

  // Track if request was auto-claimed when opening
  const wasAutoClaimedRef = React.useRef(false);

  // Snapshot initial values at modal open for close-time revert logic
  const initialStatusRef = React.useRef<Status>(request.status);
  const initialStudentResponseRef = React.useRef(request.studentResponse || '');

  // Tracks explicit user interaction vs automatic status sync/autoclaim
  const hasStatusManualChangeRef = React.useRef(false);

  const isReader = profile?.role === 'lector';

  // Realtime lock detection - check if another user has this request in review
  const lockState = useRealtimeLock(
    request.id,
    profile?.initials || null,
    request.status,
    request.responsible
  );

  // Determine if the request is locked by another user
  // This is true if:
  // 1. The request was already "EN REVISIÓN" when we opened it AND
  // 2. The responsible is NOT the current user
  const wasAlreadyInReviewByOther = React.useMemo(() => {
    return request.status === 'EN REVISIÓN' &&
      request.responsible &&
      profile?.initials &&
      request.responsible !== profile.initials;
  }, [request.status, request.responsible, profile?.initials]);

  // Combined lock state: either initial lock or realtime detected lock
  const isLockedByOther = wasAlreadyInReviewByOther || lockState.isLocked;
  const lockedByUser = wasAlreadyInReviewByOther ? request.responsible : lockState.lockedBy;

  // If locked by other, treat as read-only
  const isEffectivelyReadOnly = isReader || isLockedByOther;

  // Find the next related case (consecutive middle number)
  const getNextRelatedCase = (): Request | null => {
    if (!request.caseId) return null;
    const parts = request.caseId.split('-');
    if (parts.length !== 3) return null;

    const [prefix, middleStr, suffix] = parts;
    const middleNum = parseInt(middleStr, 10);
    if (isNaN(middleNum)) return null;

    const nextMiddle = (middleNum + 1).toString().padStart(2, '0');
    const nextCaseId = `${prefix}-${nextMiddle}-${suffix}`;

    return allRequests.find(r => r.caseId === nextCaseId) || null;
  };

  const nextRelatedCase = getNextRelatedCase();

  // Sync local status when request prop updates (e.g. from realtime)
  useEffect(() => {
    setStatus(request.status);
    setInternalResponse(request.internalResponse);
    setStudentResponse(request.studentResponse);
  }, [request.status, request.internalResponse, request.studentResponse]);

  // Track closing state to prevent reactive auto-claim from triggering during unclaim
  const isClosingRef = React.useRef(false);

  // Track if user has explicitly saved - prevents re-claim after save
  const hasSavedRef = React.useRef(false);

  // Auto-claim: When opening a "POR REVISAR" request, automatically set to "EN REVISIÓN"
  // Skip if already locked by another user
  // REVISED: Now reactive to request.status changes to handle "A releases -> B claims" flow
  useEffect(() => {
    const attemptAutoClaim = async () => {
      // 0. Closing guard: If we are in the process of closing/unclaiming, DO NOT reclaim
      if (isClosingRef.current) return;

      // 0.5 Saved guard: If user has explicitly saved, DO NOT reclaim
      // This prevents the race condition where Realtime arrives after save but before close
      if (hasSavedRef.current) return;

      console.log('Auto-claim check:', {
        id: request.id,
        status: request.status,
        localStatus: status, // Log local status too
        isLocked: isLockedByOther,
        wasClaimed: wasAutoClaimedRef.current,
        initials: profile?.initials
      });

      // 1. Basic guards: Reader or no profile -> can't claim
      if (isReader || !profile) return;

      // 2. Lock guard: If locked by another user -> can't claim
      if (isLockedByOther) return;

      // 3. Status logic: Only claim if it is 'POR REVISAR'
      // Check BOTH the prop status AND local status - if user has changed local status
      // to POR REVISAR intentionally, don't autoclaim
      // If I already claimed it (wasAutoClaimedRef) and status is EN REVISIÓN, we are good.
      if (request.status !== 'POR REVISAR') return;

      // 3.5 If local status is POR REVISAR but user has explicitly set it (not first load),
      // don't autoclaim. This handles cases where user changes from EN REVISIÓN to POR REVISAR
      // and the realtime update arrives.
      if (wasAutoClaimedRef.current && status === 'POR REVISAR') {
        console.log('Skipping autoclaim: user has explicitly set status to POR REVISAR');
        return;
      }

      try {
        // ATOMIC UPDATE: Only claim if status is STILL "POR REVISAR" in the database
        // This prevents race conditions where two users try to claim simultaneously
        const { data, error } = await supabase
          .from('observacion')
          .update({
            obs_estatus: 'EN REVISIÓN',
            obs_responsable: profile.initials
          })
          .eq('obs_id', request.id)
          .eq('obs_estatus', 'POR REVISAR') // Only update if status is still POR REVISAR
          .select('obs_id');

        if (error) throw error;

        // Check if the update actually happened (row was modified)
        if (data && data.length > 0) {
          // Successfully claimed
          wasAutoClaimedRef.current = true;
          setStatus('EN REVISIÓN'); // Update local UI immediately

          // If user closed while claim request was in-flight, immediately release
          if (isClosingRef.current) {
            const { data: revertedRows, error: revertError } = await supabase
              .from('observacion')
              .update({
                obs_estatus: 'POR REVISAR',
                obs_responsable: ''
              })
              .eq('obs_id', request.id)
              .eq('obs_estatus', 'EN REVISIÓN')
              .eq('obs_responsable', profile.initials)
              .select('obs_id');

            if (revertError) throw revertError;

            if (revertedRows && revertedRows.length > 0) {
              wasAutoClaimedRef.current = false;
              setStatus('POR REVISAR');
              onUpdate({ ...request, status: 'POR REVISAR', responsible: '' });
            }
            return;
          }

          // Audit log for claim
          await supabase.from('audit_logs').insert({
            user_id: profile.id,
            case_id: request.caseId,
            action: 'CLAIM_REQUEST',
            details: { description: 'Solicitud tomada automáticamente' },
            changes: { status: { old: 'POR REVISAR', new: 'EN REVISIÓN' } }
          });
        } else {
          // Someone else already claimed it - fetch current state
          // This might happen if 'A' re-claimed it very fast, or 'C' jumped in
          console.log('Request already claimed by another user during reactive claim');
        }
      } catch (err) {
        console.error('Error auto-claiming request:', err);
      }
    };

    attemptAutoClaim();
    // Re-run this check when:
    // 1. Request status changes (e.g. from Realtime update when A releases)
    // 2. Lock state changes (e.g. A releases lock)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.status, isLockedByOther]);

  const handleClose = async () => {
    isClosingRef.current = true;

    const startedAsPorRevisar = initialStatusRef.current === 'POR REVISAR';
    const hasMeaningfulChanges =
      hasStatusManualChangeRef.current ||
      studentResponse.trim() !== initialStudentResponseRef.current.trim();

    // If the request was auto-claimed and the user didn't change the status
    // (still EN REVISIÓN), revert to POR REVISAR
    if (startedAsPorRevisar && !hasMeaningfulChanges && !isReader && profile) {
      try {
        const { data: revertedRows, error: revertError } = await supabase
          .from('observacion')
          .update({
            obs_estatus: 'POR REVISAR',
            obs_responsable: ''
          })
          .eq('obs_id', request.id)
          .eq('obs_estatus', 'EN REVISIÓN') // Logic safety: only revert if still in review
          .eq('obs_responsable', profile.initials) // Security: only if locked by CURRENT user
          .select('obs_id');

        if (revertError) throw revertError;

        if (revertedRows && revertedRows.length > 0) {
          // Audit log for unclaim
          await supabase.from('audit_logs').insert({
            user_id: profile.id,
            case_id: request.caseId,
            action: 'UNCLAIM_REQUEST',
            details: { description: 'Solicitud liberada al cerrar sin resolver' },
            changes: { status: { old: 'EN REVISIÓN', new: 'POR REVISAR' } }
          });

          // Update parent component with reverted status
          onUpdate({ ...request, status: 'POR REVISAR', responsible: '' });
        } else {
          console.warn(`Unclaim skipped for request ${request.id}: no matching row to revert`);
        }
      } catch (err) {
        console.error('Error reverting request:', err);
      }
    } else if (wasAutoClaimedRef.current && status !== request.status) {
      // User changed status from EN REVISIÓN to something else
      // Update parent with new status
      onUpdate({ ...request, status, responsible: profile?.initials || request.responsible });
    }

    onClose();
  };

  const canSave = status !== 'SOLUCIONADO' || studentResponse.trim() !== '';

  const handleSave = async () => {
    if (isReader || !profile || !canSave) return;

    // Estados que NO requieren respuesta externa
    const statesWithoutExternalResponse = ['POR REVISAR', 'EN REVISIÓN', 'IGNORADO', 'REPETIDO'];

    // Validar que si el estado requiere respuesta externa, debe tener respuesta externa
    if (!statesWithoutExternalResponse.includes(status) && (!studentResponse || studentResponse.trim() === '')) {
      alert('No se puede guardar. Las solicitudes con estado "Solucionado", "No Procede" o "Revisado" deben tener una respuesta al estudiante.');
      return;
    }

    // IMPORTANT: Set closing flag BEFORE any async operations to prevent
    // the autoclaim useEffect from re-claiming after we save
    isClosingRef.current = true;

    // Mark that user has explicitly saved - prevents re-claim from realtime updates
    hasSavedRef.current = true;

    // Clear autoclaim ref since user explicitly saved - this prevents
    // handleClose from trying to unclaim a request that user intentionally modified
    wasAutoClaimedRef.current = false;

    setSaving(true);
    try {
      const hasExternalResponseChange =
        studentResponse.trim() !== initialStudentResponseRef.current.trim();
      const hasMeaningfulChanges = hasStatusManualChangeRef.current || hasExternalResponseChange;

      // Business rule: if user did not change status manually and did not add external response,
      // request should be released back to POR REVISAR.
      const statusToPersist: Status = hasMeaningfulChanges ? status : 'POR REVISAR';

      const updates: any = {
        obs_estatus: statusToPersist,
        obs_respuesta_interna: internalResponse,
        obs_respuesta_externa: studentResponse
      };

      // If status changed or response added, update responsible
      const hasChanges = statusToPersist !== request.status ||
        internalResponse !== request.internalResponse ||
        studentResponse !== request.studentResponse;

      if (hasChanges) {
        // If setting back to POR REVISAR, clear the responsible
        // Otherwise, set to current user
        updates.obs_responsable = statusToPersist === 'POR REVISAR' ? '' : profile.initials;
      }

      // Update Database
      const { error } = await supabase
        .from('observacion')
        .update(updates)
        .eq('obs_id', request.id);

      if (error) throw error;

      // Audit Log
      if (hasChanges) {
        const changes: any = {};
        if (statusToPersist !== request.status) changes.status = { old: request.status, new: statusToPersist };
        if (internalResponse !== request.internalResponse) changes.internalResponse = { old: request.internalResponse, new: internalResponse };
        if (studentResponse !== request.studentResponse) changes.studentResponse = { old: request.studentResponse, new: studentResponse };

        await supabase.from('audit_logs').insert({
          user_id: profile.id,
          case_id: request.caseId,
          action: 'UPDATE_REQUEST',
          details: { description: 'Actualización desde vista de lista solicitudes' },
          changes: changes
        });
      }

      onUpdate({
        ...request,
        status: statusToPersist,
        internalResponse,
        studentResponse,
        responsible: updates.obs_responsable !== undefined ? updates.obs_responsable : request.responsible
      });
      setShowSuccessModal(true);
    } catch (err) {
      console.error('Error updating request:', err);
      alert('Error al guardar los cambios');
    } finally {
      setSaving(false);
    }
  };

  // Get colors based on current status
  const getStatusColors = () => {
    switch (status) {
      case 'POR REVISAR': return { border: 'border-rose-500', bg: 'bg-rose-50/30 dark:bg-rose-900/10', text: 'text-rose-900 dark:text-rose-100', btn: 'hover:bg-rose-100/50 dark:hover:bg-rose-900/40', icon: 'text-rose-600' };
      case 'EN REVISIÓN': return { border: 'border-amber-500', bg: 'bg-amber-50/30 dark:bg-amber-900/10', text: 'text-amber-900 dark:text-amber-100', btn: 'hover:bg-amber-100/50 dark:hover:bg-amber-900/40', icon: 'text-amber-600' };
      case 'SOLUCIONADO': return { border: 'border-emerald-500', bg: 'bg-emerald-50/30 dark:bg-emerald-900/10', text: 'text-emerald-900 dark:text-emerald-100', btn: 'hover:bg-emerald-100/50 dark:hover:bg-emerald-900/40', icon: 'text-emerald-600' };
      case 'NO PROCEDE': return { border: 'border-orange-500', bg: 'bg-orange-50/30 dark:bg-orange-900/10', text: 'text-orange-900 dark:text-orange-100', btn: 'hover:bg-orange-100/50 dark:hover:bg-orange-900/40', icon: 'text-orange-600' };
      case 'IGNORADO': return { border: 'border-slate-400', bg: 'bg-slate-50/30 dark:bg-slate-800/30', text: 'text-slate-700 dark:text-slate-300', btn: 'hover:bg-slate-100/50 dark:hover:bg-slate-800/40', icon: 'text-slate-500' };
      case 'REPETIDO': return { border: 'border-purple-500', bg: 'bg-purple-50/30 dark:bg-purple-900/10', text: 'text-purple-900 dark:text-purple-100', btn: 'hover:bg-purple-100/50 dark:hover:bg-purple-900/40', icon: 'text-purple-600' };
      case 'REVISADO': return { border: 'border-blue-500', bg: 'bg-blue-50/30 dark:bg-blue-900/10', text: 'text-blue-900 dark:text-blue-100', btn: 'hover:bg-blue-100/50 dark:hover:bg-blue-900/40', icon: 'text-blue-600' };
      default: return { border: 'border-emerald-600', bg: 'bg-emerald-50/30 dark:bg-emerald-900/10', text: 'text-emerald-900 dark:text-emerald-100', btn: 'hover:bg-emerald-100/50 dark:hover:bg-emerald-900/40', icon: 'text-emerald-600' };
    }
  };

  const colors = getStatusColors();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className={`bg-white dark:bg-surface-dark w-full max-w-3xl rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200 border-t-8 ${colors.border} transition-colors`}>
        <div className={`flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800 ${colors.bg} transition-colors`}>
          <h2 className={`text-xl font-bold ${colors.text} italic flex items-center gap-2 transition-colors`}>
            <span className="material-symbols-outlined">description</span>
            Observación #{request.caseId}
          </h2>
          <button onClick={handleClose} className={`p-2 rounded-full ${colors.btn} transition-colors`}>
            <span className={`material-symbols-outlined ${colors.icon}`}>close</span>
          </button>
        </div>

        {/* Related Case Indicator */}
        {nextRelatedCase && (
          <div className={`px-6 py-2 ${colors.bg} border-b border-slate-100 dark:border-slate-800 flex items-center gap-2`}>
            <span className="material-symbols-outlined text-indigo-500 text-[18px]">link</span>
            <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
              Esta solicitud está relacionada con el caso <span className="font-bold">#{nextRelatedCase.caseId}</span>
            </span>
          </div>
        )}

        {/* Locked by another user banner */}
        {isLockedByOther && lockedByUser && (
          <div className="px-6 pt-4">
            <LockedBanner lockedBy={lockedByUser} />
          </div>
        )}

        <div className="p-8 overflow-y-auto max-h-[70vh] space-y-6">
          {/* Student Profile Header */}
          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-5 border border-slate-200 dark:border-slate-700">
            <div className="flex flex-col md:flex-row gap-5 items-start md:items-center">
              <div className="relative shrink-0">
                <div className="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 overflow-hidden border-2 border-white dark:border-gray-600 shadow-sm flex items-center justify-center">
                  <span className="text-emerald-600 dark:text-emerald-400 text-xl font-black">
                    {request.studentName.split(' ').map(n => n[0]).slice(0, 2).join('')}
                  </span>
                </div>
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{request.studentName}</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-sm text-slate-500 dark:text-slate-400">
                  <p className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">badge</span>
                    <span
                      className="hover:text-emerald-600 dark:hover:text-emerald-400 cursor-pointer transition-colors flex items-center gap-1 group"
                      title="Copiar cédula"
                      onClick={() => {
                        navigator.clipboard.writeText(request.studentId);
                      }}
                    >
                      C.I.: {request.studentId}
                      <span className="material-symbols-outlined text-[14px] opacity-0 group-hover:opacity-100 transition-opacity">content_copy</span>
                    </span>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">school</span>
                    Semestre: {request.semester || 'N/A'}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">grade</span>
                    Promedio: {request.gpa || 'N/A'}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">credit_card</span>
                    UC: {request.credits || 'N/A'}
                  </p>
                  <p className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px]">alternate_email</span>
                    {request.contact || 'Sin correo'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Materia and Action Info slice - removed double block */}
          <div className="grid grid-cols-1 md:grid-cols-10 gap-4">
            <div
              className="md:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 border-l-4"
              style={{ borderLeftColor: DEPARTMENT_COLORS[request.classification] || 'transparent' }}
            >
              <label className="text-[10px] font-bold uppercase text-slate-500 mb-2 block flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">menu_book</span>
                Materia Solicitada
              </label>
              <p className="font-bold text-slate-900 dark:text-white">{request.subject}</p>
              <p className="text-sm text-slate-500">
                NRC: {request.nrc === 0 ? 'sin nrc sugerido' : request.nrc} •
                Departamento: <span className="font-bold text-primary">{DEPARTMENT_NAMES[request.classification] || request.classification}</span>
              </p>
            </div>
            <div className="md:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <label className="text-[10px] font-bold uppercase text-slate-500 mb-2 block flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">swap_horiz</span>
                Acción Solicitada
              </label>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold ${request.action === 'Agregar'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                }`}>
                <span className="material-symbols-outlined text-[18px]">
                  {request.action === 'Agregar' ? 'add_circle' : 'remove_circle'}
                </span>
                {request.action || 'No especificada'}
              </span>
            </div>
            <div className="md:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
              <label className="text-[10px] font-bold uppercase text-slate-500 mb-2 block flex items-center gap-1">
                <span className="material-symbols-outlined text-[14px]">schedule</span>
                Cambio de Horario
              </label>
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold ${request.authorized
                ? 'bg-blue-800 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'bg-rose-600 text-white dark:bg-rose-500'
                }`}>
                <span className="material-symbols-outlined text-[18px]">
                  {request.authorized ? 'check_circle' : 'block'}
                </span>
                {request.authorized ? 'AUTORIZA' : 'NO AUTORIZA'}
              </span>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-slate-500 mb-1 block">Justificación del Estudiante</label>
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-sm italic border border-slate-100 dark:border-slate-800">
              "{request.comments || 'Sin comentarios'}"
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500 mb-1 block">Estatus</label>
              <select
                value={status}
                disabled={isEffectivelyReadOnly}
                onChange={(e) => {
                  hasStatusManualChangeRef.current = true;
                  setStatus(e.target.value as Status);
                }}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-50 disabled:bg-slate-100"
              >
                {['POR REVISAR', 'EN REVISIÓN', 'REVISADO', 'SOLUCIONADO', 'NO PROCEDE', 'REPETIDO', 'IGNORADO'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase text-slate-500 mb-1 block">Responsable Gestión</label>
              <div className="flex items-center gap-2 p-2 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-sm font-bold text-emerald-700 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-800">
                <span className="material-symbols-outlined text-[18px]">verified_user</span>
                {request.responsible || 'Sin asignar'}
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-slate-500 mb-1 block">
              Respuesta Interna
            </label>
            <textarea
              value={internalResponse}
              disabled={isEffectivelyReadOnly}
              onChange={(e) => setInternalResponse(e.target.value)}
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 text-sm min-h-[80px] disabled:opacity-50 disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              placeholder="Notas para el equipo administrativo..."
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold uppercase text-slate-500 block">
                Respuesta al Estudiante {status === 'SOLUCIONADO' && <span className="text-rose-500">*</span>}
              </label>
              {!isEffectivelyReadOnly && (
                <select
                  className="text-xs bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      setStudentResponse(e.target.value);
                    }
                  }}
                >
                  <option value="">📋 Respuestas predefinidas...</option>
                  {Object.entries(RESPONSES_BY_CATEGORY).map(([category, responses]) => (
                    <optgroup key={category} label={category}>
                      {responses.map((resp) => (
                        <option key={resp.id} value={resp.text}>
                          {resp.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
            </div>
            <textarea
              value={studentResponse}
              disabled={isEffectivelyReadOnly}
              onChange={(e) => setStudentResponse(e.target.value)}
              className={`w-full bg-white dark:bg-slate-900 border ${status === 'SOLUCIONADO' && studentResponse.trim() === '' ? 'border-rose-300 dark:border-rose-900' : 'border-slate-200 dark:border-slate-800'} rounded-lg p-3 text-sm min-h-[80px] disabled:opacity-50 disabled:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/20`}
              placeholder="Este mensaje será enviado al estudiante..."
            />
          </div>
          {status === 'SOLUCIONADO' && !studentResponse.trim() && (
            <p className="text-[11px] text-rose-500 font-bold flex items-center gap-1 animate-pulse">
              <span className="material-symbols-outlined text-[14px]">warning</span>
              Debes agregar una respuesta al estudiante para marcar como SOLUCIONADO
            </p>
          )}
        </div>

        <div className="p-6 bg-slate-50 dark:bg-slate-800/20 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3">
          <button
            onClick={handleClose}
            className="px-4 py-2 rounded-lg text-sm font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors"
          >
            Cancelar
          </button>
          {!isEffectivelyReadOnly && (
            <button
              onClick={handleSave}
              disabled={saving || !canSave}
              className="px-6 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:bg-slate-300 dark:disabled:bg-slate-800 shadow-sm shadow-emerald-200 dark:shadow-none"
            >
              {saving ? 'Guardando...' : 'Guardar Cambios'}
            </button>
          )}
        </div>
      </div>

      <SuccessModal
        isOpen={showSuccessModal}
        onClose={() => {
          setShowSuccessModal(false);
          onClose();
        }}
        title="¡Cambios Guardados!"
        message="La solicitud ha sido actualizada correctamente."
      />
    </div>
  );
};
