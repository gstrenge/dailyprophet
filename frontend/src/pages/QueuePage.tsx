import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { Clip, ClipOrderRequest } from "../api/types";
import ClipCard from "../components/ClipCard";
import StorageMeter from "../components/StorageMeter";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState, useEffect } from "react";

export default function QueuePage() {
  const qc = useQueryClient();
  const { data: serverClips = [], isLoading } = useQuery<Clip[]>({
    queryKey: ["clips"],
    queryFn: () => apiFetch("/clips"),
    refetchInterval: 3000,
  });

  const [clips, setClips] = useState<Clip[]>([]);
  useEffect(() => { setClips(serverClips); }, [serverClips]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const reorderMut = useMutation({
    mutationFn: (order: string[]) =>
      apiFetch<void>("/clips/order", {
        method: "PATCH",
        body: JSON.stringify({ order } satisfies ClipOrderRequest),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["clips"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/clips/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clips"] });
      qc.invalidateQueries({ queryKey: ["storage"] });
    },
  });

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = clips.findIndex((c) => c.id === active.id);
    const newIndex = clips.findIndex((c) => c.id === over.id);
    const reordered = arrayMove(clips, oldIndex, newIndex);
    setClips(reordered);
    reorderMut.mutate(reordered.map((c) => c.id));
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "0.5rem" }}>
        <h2 className="section-heading">The Enchanted Gallery</h2>
        <StorageMeter />
      </div>
      <hr className="rule" />

      {isLoading && <p style={{ marginTop: "1rem", fontStyle: "italic" }}>Consulting the archives…</p>}

      {!isLoading && clips.length === 0 && (
        <div className="card" style={{ marginTop: "1rem", textAlign: "center", fontStyle: "italic" }}>
          <p>The gallery awaits its first portrait.</p>
          <p style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
            <a href="/">Upload a clip</a> to begin.
          </p>
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={clips.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              onDelete={() => deleteMut.mutate(clip.id)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
