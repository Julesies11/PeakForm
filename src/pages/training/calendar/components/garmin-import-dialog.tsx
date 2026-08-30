import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  FileUp,
  Info,
  Loader2,
  Settings2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  useGarminMappings,
  useUpsertGarminMapping,
} from '@/hooks/use-garmin-mapping';
import { useSupabaseUserId } from '@/hooks/use-supabase-user';
import {
  useCreateWorkoutsBulk,
  useSportTypes,
} from '@/hooks/use-training-data';
import { eventsApi } from '@/services/api/training/events.api';
import { workoutsApi } from '@/services/api/training/workouts.api';
import { parseGarminCSV } from '@/services/training/garmin.utils';
import { ProcessedImportRow } from '@/services/training/import.utils';
import { applySmartSync } from '@/services/training/sync.utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { GarminMappingsDialog } from './garmin-mappings-dialog';

interface GarminImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport?: (workouts: Partial<Workout>[]) => void;
}

export function GarminImportDialog({
  open,
  onOpenChange,
  onImport,
}: GarminImportDialogProps) {
  const userId = useSupabaseUserId();
  const { data: sportTypes = [] } = useSportTypes();
  const { data: mappings = [], refetch: refetchMappings } = useGarminMappings();
  const upsertMapping = useUpsertGarminMapping();
  const createWorkoutsBulk = useCreateWorkoutsBulk();

  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [rawContent, setRawContent] = useState('');
  const [processedRows, setProcessedRows] = useState<ProcessedImportRow[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [step, setStep] = useState<'input' | 'mapping' | 'preview'>('input');
  const [showMappings, setShowMappings] = useState(false);
  const [pendingMappings, setPendingMappings] = useState<
    Record<string, { sportTypeId: string; unit: 'km' | 'm' }>
  >({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Identify unique unmapped Garmin activity types from the current import
  // Only those that are TRULY unmapped (not even ignored)
  const unmappedTypes = useMemo(() => {
    const types = new Set<string>();
    processedRows.forEach((row) => {
      if (!row.isValid && row.errors.some((e) => e.includes('Unmapped'))) {
        const name = row.row.sportName?.trim();
        if (name) {
          types.add(name);
        }
      }
    });
    return Array.from(types);
  }, [processedRows]);

  const handleProcess = async (
    input: string,
    overrideMappings?: GarminSportMapping[],
  ) => {
    if (!input.trim()) return;

    setRawContent(input);
    setIsProcessing(true);
    try {
      // 1. Parse Garmin CSV
      const rawResults = await parseGarminCSV(
        input,
        overrideMappings || mappings,
        sportTypes,
        userId || undefined,
      );

      // 2. Identify date range for sync scanning
      const dates = rawResults
        .filter((r) => r.isValid && r.workout?.date)
        .map((r) => r.workout!.date);

      let results = rawResults;

      if (dates.length > 0 && userId) {
        const sortedDates = [...dates].sort();
        const fromDate = sortedDates[0];
        const toDate = sortedDates[sortedDates.length - 1];

        // 3. Fetch existing workouts and events for the range
        const [existingWorkouts, existingEvents] = await Promise.all([
          workoutsApi.getAll(userId, fromDate, toDate),
          eventsApi.getAll(userId, fromDate, toDate),
        ]);

        // 4. Apply Smart Sync matching
        results = applySmartSync(rawResults, existingWorkouts, existingEvents);
      }

      setProcessedRows(results);

      const hasUnmapped = results.some(
        (r) => !r.isValid && r.errors.some((e) => e.includes('Unmapped')),
      );

      // If we have unmapped rows, but couldn't identify the types (e.g. missing name),
      // we still need to go to a step that lets the user know or proceed with what's valid.
      if (hasUnmapped) {
        // If we found unmapped rows but the 'unmappedTypes' list is empty (shouldn't happen with the fix above),
        // we skip to preview so the user can at least see the errors.
        const types = new Set<string>();
        results.forEach((row) => {
          if (!row.isValid && row.errors.some((e) => e.includes('Unmapped'))) {
            const name = row.row.sportName?.trim();
            if (name) types.add(name);
          }
        });

        if (types.size > 0) {
          setStep('mapping');
        } else {
          setStep('preview');
        }
      } else {
        setStep('preview');
      }
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to parse data';
      toast.error(message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      handleProcess(content);
    };
    reader.readAsText(file);
  };

  const handleSaveMappings = async () => {
    try {
      const promises = Object.entries(pendingMappings).map(
        ([garminType, mappingInfo]) =>
          upsertMapping.mutateAsync({
            garminActivityType: garminType,
            sportTypeId:
              mappingInfo.sportTypeId === 'ignore'
                ? null
                : mappingInfo.sportTypeId,
            garminDistanceUnit: mappingInfo.unit,
          }),
      );
      await Promise.all(promises);
      toast.success('Mappings saved successfully');

      // Force a fresh fetch of mappings from the DB
      const { data: freshMappings } = await refetchMappings();

      // Reprocess with the same content now that we have more mappings
      if (rawContent) {
        handleProcess(rawContent, freshMappings);
      } else {
        setStep('preview');
      }
    } catch (error) {
      console.error('Failed to save mappings:', error);
      toast.error('Failed to save mappings');
    }
  };

  const handleImport = () => {
    const validWorkouts = processedRows
      .filter((r) => r.isValid && r.workout)
      .map((r) => r.workout!);

    if (validWorkouts.length === 0) {
      toast.error('No valid workouts to import');
      return;
    }

    if (onImport) {
      onImport(validWorkouts);
      toast.success(
        `Successfully imported ${validWorkouts.length} Garmin activities`,
      );
      onOpenChange(false);
      return;
    }

    createWorkoutsBulk.mutate(validWorkouts, {
      onSuccess: () => {
        toast.success(
          `Successfully imported ${validWorkouts.length} Garmin activities`,
        );
        onOpenChange(false);
      },
      onError: (error: Error) => {
        toast.error(error.message || 'Failed to import workouts');
      },
    });
  };

  const resetState = () => {
    setProcessedRows([]);
    setStep('input');
    setPastedText('');
    setPendingMappings({});
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const validCount = processedRows.filter((r) => r.isValid).length;
  const ignoredCount = processedRows.filter(
    (r) => !r.isValid && r.errors.some((e) => e.includes('Ignored')),
  ).length;
  const totalCount = processedRows.length;
  const hasActualErrors = processedRows.some(
    (r) => !r.isValid && !r.errors.some((e) => e.includes('Ignored')),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) resetState();
      }}
    >
      <DialogContent className="max-w-4xl w-[95vw] md:w-full max-h-[95vh] md:max-h-[90vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 md:px-6 md:py-4 border-b flex flex-row items-center justify-between">
          <div className="flex flex-col gap-1">
            <DialogTitle className="text-lg md:text-xl font-black lowercase tracking-tight">
              import garmin activities
            </DialogTitle>
            <DialogDescription className="sr-only">
              Upload your Garmin CSV export to sync your activities to
              TrainingFlow.
            </DialogDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowMappings(true)}
            className="h-8 text-[10px] font-black uppercase tracking-widest gap-2 bg-background border-primary/20 hover:bg-primary/5 mr-8"
          >
            <Settings2 className="h-3.5 w-3.5" />
            manage mappings
          </Button>
        </DialogHeader>

        <GarminMappingsDialog
          open={showMappings}
          onOpenChange={setShowMappings}
        />

        <div className="flex-1 overflow-y-auto px-4 py-2 md:px-6 md:py-3">
          {step === 'input' && (
            <div className="space-y-4">
              <div className="bg-primary/5 rounded-xl border border-primary/10 p-3 md:p-4">
                <div className="flex items-start gap-4">
                  <div className="space-y-1">
                    <h4 className="text-sm font-black lowercase text-primary flex items-center gap-2">
                      <Info className="h-4 w-4" />
                      garmin export guide
                    </h4>
                    <p className="text-xs font-medium text-primary/80 leading-relaxed max-w-prose">
                      Export your activities from Garmin Connect as a CSV file.
                      Go to &quot;Activities&quot; -&gt; &quot;All
                      Activities&quot;, then click the &quot;Export CSV&quot;
                      button at the top right. Upload the file here to sync your
                      completed sessions to TrainingFlow.
                    </p>
                  </div>
                </div>
              </div>

              <Tabs
                value={activeTab}
                onValueChange={(v: string) =>
                  setActiveTab(v as 'upload' | 'paste')
                }
                className="w-full"
              >
                <TabsList className="w-full justify-start border-b rounded-none bg-transparent h-auto p-0 mb-6">
                  <TabsTrigger
                    value="upload"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 md:px-6 py-3 text-xs md:text-sm"
                  >
                    <FileUp className="h-4 w-4 mr-2" />
                    upload csv
                  </TabsTrigger>
                  <TabsTrigger
                    value="paste"
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 md:px-6 py-3 text-xs md:text-sm"
                  >
                    <ClipboardList className="h-4 w-4 mr-2" />
                    paste csv content
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="upload" className="mt-0">
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed rounded-2xl p-8 md:p-12 flex flex-col items-center justify-center cursor-pointer hover:bg-muted/30 transition-colors group"
                  >
                    <div className="h-10 w-10 md:h-12 md:w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                      <FileUp className="h-5 w-5 md:h-6 md:w-6 text-primary" />
                    </div>
                    <p className="text-xs md:text-sm font-bold text-foreground mb-1 lowercase">
                      click or drag and drop to upload
                    </p>
                    <p className="text-[10px] md:text-xs text-muted-foreground lowercase">
                      select your garmin_activities.csv file
                    </p>
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept=".csv"
                      className="hidden"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="paste" className="mt-0 space-y-4">
                  <Textarea
                    placeholder="paste your garmin CSV content here (including headers)"
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    className="min-h-[150px] md:min-h-[200px] font-mono text-xs"
                  />
                  <Button
                    onClick={() => handleProcess(pastedText)}
                    disabled={!pastedText.trim() || isProcessing}
                    className="w-full h-11 font-bold lowercase"
                  >
                    {isProcessing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      'process csv'
                    )}
                  </Button>
                </TabsContent>
              </Tabs>
            </div>
          )}

          {step === 'mapping' && (
            <div className="space-y-6 py-4">
              <div className="flex flex-col gap-1">
                <h3 className="text-base font-black lowercase flex items-center gap-2">
                  <Settings2 className="h-5 w-5" />
                  map garmin activities
                </h3>
                <p className="text-xs text-muted-foreground lowercase">
                  we found some garmin activity types that aren&apos;t linked to
                  your sports. please map them below to continue.
                </p>
              </div>

              <div className="space-y-2">
                {/* Column Headers */}
                <div className="grid grid-cols-12 gap-3 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  <div className="col-span-4">garmin type</div>
                  <div className="col-span-2">garmin unit</div>
                  <div className="col-span-1" />
                  <div className="col-span-5">mapped to</div>
                </div>

                {/* Mapping Rows */}
                <div className="space-y-3">
                  {unmappedTypes.map((garminType) => (
                    <div
                      key={garminType}
                      className="grid grid-cols-12 gap-3 p-4 rounded-xl border bg-muted/30 items-center"
                    >
                      <div className="col-span-4 flex items-center gap-3">
                        <span className="text-sm font-bold lowercase truncate">
                          {garminType}
                        </span>
                      </div>

                      <div className="col-span-2">
                        <Select
                          defaultValue="km"
                          onValueChange={(val: 'km' | 'm') =>
                            setPendingMappings((prev) => ({
                              ...prev,
                              [garminType]: {
                                sportTypeId:
                                  prev[garminType]?.sportTypeId || '',
                                unit: val,
                              },
                            }))
                          }
                        >
                          <SelectTrigger className="h-9 text-xs lowercase border border-muted-foreground/10 bg-background hover:bg-muted/20 hover:border-muted-foreground/20 transition-colors">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              value="km"
                              className="lowercase text-xs"
                            >
                              km
                            </SelectItem>
                            <SelectItem value="m" className="lowercase text-xs">
                              m
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="col-span-1 flex justify-center opacity-30">
                        <ArrowRight className="h-4 w-4" />
                      </div>

                      <div className="col-span-5">
                        <Select
                          onValueChange={(val) =>
                            setPendingMappings((prev) => ({
                              ...prev,
                              [garminType]: {
                                sportTypeId: val,
                                unit: prev[garminType]?.unit || 'km',
                              },
                            }))
                          }
                        >
                          <SelectTrigger className="h-9 text-xs lowercase border border-muted-foreground/10 bg-background hover:bg-muted/20 hover:border-muted-foreground/20 transition-colors">
                            <SelectValue placeholder="select sport" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem
                              value="ignore"
                              className="font-bold uppercase text-xs"
                            >
                              IGNORE
                            </SelectItem>
                            {sportTypes.map((st) => (
                              <SelectItem
                                key={st.id}
                                value={st.id}
                                className="text-xs lowercase"
                              >
                                {st.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-8">
                <Button
                  variant="ghost"
                  onClick={() => setStep('input')}
                  className="font-bold lowercase"
                >
                  back
                </Button>
                <Button
                  onClick={handleSaveMappings}
                  disabled={
                    Object.keys(pendingMappings).length <
                      unmappedTypes.length || upsertMapping.isPending
                  }
                  className="font-bold lowercase"
                >
                  {upsertMapping.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    'save mappings & continue'
                  )}
                </Button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm md:text-base font-black lowercase tracking-tight">
                    preview garmin activities
                  </h3>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[9px] md:text-[10px] font-bold bg-green-500/10 text-green-600 px-2 py-0.5 rounded-full">
                      {validCount} ready
                    </span>
                    {ignoredCount > 0 && (
                      <span className="text-[9px] md:text-[10px] font-bold bg-warning/10 text-warning px-2 py-0.5 rounded-full">
                        {ignoredCount} ignored
                      </span>
                    )}
                    {hasActualErrors && (
                      <span className="text-[9px] md:text-[10px] font-bold bg-destructive/10 text-destructive px-2 py-0.5 rounded-full">
                        {totalCount - validCount - ignoredCount} errors
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStep('input')}
                  className="h-8 text-[10px] md:text-xs font-black uppercase tracking-widest gap-2 bg-background border-primary/20 hover:bg-primary/5"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  back to input
                </Button>
              </div>

              {hasActualErrors && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-[10px] md:text-xs font-bold">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Warning: some activities still have mapping errors. They will
                  be skipped during import.
                </div>
              )}

              <div className="border rounded-xl overflow-x-auto">
                <div className="min-w-[600px]">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="w-[120px] text-[10px] font-black uppercase">
                          date
                        </TableHead>
                        <TableHead className="w-[120px] text-[10px] font-black uppercase">
                          garmin type
                        </TableHead>
                        <TableHead className="w-[120px] text-[10px] font-black uppercase">
                          mapped to
                        </TableHead>
                        <TableHead className="w-[80px] text-[10px] font-black uppercase">
                          status
                        </TableHead>
                        <TableHead className="text-[10px] font-black uppercase">
                          title
                        </TableHead>
                        <TableHead className="w-[80px] text-[10px] font-black uppercase">
                          dur (m)
                        </TableHead>
                        <TableHead className="w-[80px] text-[10px] font-black uppercase">
                          dist
                        </TableHead>
                        <TableHead className="w-[40px] text-[10px] font-black uppercase"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {processedRows.map((row, idx) => (
                        <React.Fragment key={idx}>
                          <TableRow
                            className={
                              !row.isValid
                                ? 'bg-destructive/5 hover:bg-destructive/10'
                                : ''
                            }
                          >
                            <TableCell className="text-xs font-medium py-3">
                              {row.row.date || '---'}
                            </TableCell>
                            <TableCell className="text-xs py-3">
                              <div className="flex flex-col gap-0.5">
                                <span
                                  className={
                                    !row.isValid &&
                                    row.errors.some((e) =>
                                      e.includes('Unmapped'),
                                    )
                                      ? 'text-destructive font-bold'
                                      : ''
                                  }
                                >
                                  {row.row.sportName || '---'}
                                </span>
                                {row.errors.some((e) =>
                                  e.includes('Ignored'),
                                ) && (
                                  <span className="text-warning font-black uppercase text-[9px] tracking-tight">
                                    Ignored
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs py-3">
                              {(() => {
                                if (
                                  row.errors.some((e) => e.includes('Ignored'))
                                ) {
                                  return (
                                    <span className="text-warning font-black uppercase text-[10px]">
                                      IGNORE
                                    </span>
                                  );
                                }
                                if (row.workout?.sportTypeId) {
                                  const sport = sportTypes.find(
                                    (st) => st.id === row.workout?.sportTypeId,
                                  );
                                  return (
                                    <span className="font-bold text-primary">
                                      {sport?.name || '---'}
                                    </span>
                                  );
                                }
                                return (
                                  <span className="text-muted-foreground">
                                    ---
                                  </span>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="py-3">
                              {row.syncStatus === 'NEW' && (
                                <Badge
                                  variant="secondary"
                                  className="bg-green-500/10 text-green-600 border-green-500/20 text-[8px] font-black tracking-tighter uppercase px-1.5 h-4"
                                >
                                  New
                                </Badge>
                              )}
                              {row.syncStatus === 'SYNC' && (
                                <Badge
                                  variant="secondary"
                                  className="bg-primary/10 text-primary border-primary/20 text-[8px] font-black tracking-tighter uppercase px-1.5 h-4"
                                >
                                  Sync
                                </Badge>
                              )}
                              {row.syncStatus === 'RE-SYNC' && (
                                <Badge
                                  variant="secondary"
                                  className="bg-muted text-muted-foreground border-muted-foreground/20 text-[8px] font-black tracking-tighter uppercase px-1.5 h-4"
                                >
                                  Re-Sync
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-xs py-3 truncate max-w-[150px]">
                              {row.row.title || '---'}
                            </TableCell>
                            <TableCell className="text-xs py-3 font-mono">
                              {row.row.plannedDurationMinutes || 0}
                            </TableCell>
                            <TableCell className="text-xs py-3 font-mono">
                              {row.row.plannedDistanceKilometers || 0}
                            </TableCell>
                            <TableCell className="py-3">
                              {row.isValid ? (
                                <CheckCircle2 className="h-4 w-4 text-green-500" />
                              ) : row.errors.some((e) =>
                                  e.includes('Ignored'),
                                ) ? (
                                <X className="h-4 w-4 text-warning" />
                              ) : (
                                <AlertCircle className="h-4 w-4 text-destructive" />
                              )}
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="px-4 py-3 md:px-6 md:py-4 border-t bg-muted/30 flex flex-col sm:flex-row gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="font-bold lowercase w-full sm:w-auto"
          >
            cancel
          </Button>
          <Button
            onClick={handleImport}
            disabled={
              step !== 'preview' ||
              validCount === 0 ||
              createWorkoutsBulk.isPending
            }
            className="font-bold lowercase min-w-[120px] w-full sm:w-auto"
          >
            {createWorkoutsBulk.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              `import ${validCount} activities`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
