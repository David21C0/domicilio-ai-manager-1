import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Loader2, Clock, MapPin, User, Utensils, Package, Store, Play, Check } from 'lucide-react';
import { useSedeOrders } from '@/hooks/useSedeOrders';
import { useAuth } from '@/hooks/useAuth';
import { orderStatusService } from '@/services/orderStatusService';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';

type BoardColumnKey = 'waiting' | 'preparing';

interface KitchenCanvasProps {
  title?: string;
}

export const KitchenCanvas: React.FC<KitchenCanvasProps> = ({ title = 'Cocina' }) => {
  const { profile } = useAuth();
  const sedeId = profile?.sede_id || '';
  const { orders, loading } = useSedeOrders(sedeId);
  const [localOrderIds, setLocalOrderIds] = useState<string[]>([]);
  const [orderItems, setOrderItems] = useState<Record<number, { nombre: string; cantidad: number; tipo: 'plato' | 'bebida' | 'topping' }[]>>({});
  const [loadingItems, setLoadingItems] = useState<Record<number, boolean>>({});

  // Mapear estados a columnas visuales (solo UI)
  const board = useMemo(() => {
    const waiting = [] as any[];
    const preparing = [] as any[];

    (orders || []).forEach((order: any) => {
      const status = order.status || order.estado || 'Recibidos';
      const type = order.tipo_entrega || order.type_order || 'delivery';
      const numericId = order.orden_id || order.id || null;
      const idDisplay = order.id_display || (numericId ? `ORD-${numericId.toString().padStart(4, '0')}` : '');
      const createdAt = order.created_at || order.creado || new Date().toISOString();
      const mesa = order.mesa || null; // si en el futuro hay mesas
      const cubiertos = order.cubiertos ?? 0;

      const card = {
        id: idDisplay,
        nid: numericId as number | null,
        status,
        type,
        mesa,
        cliente: order.cliente_nombre || order.customerName || 'Cliente',
        direccion: order.address || order.direccion || '',
        created_at: createdAt,
        itemsCount: (order.items?.length) || (order.productos?.length) || undefined,
        cubiertos,
      };

      if (status === 'Cocina') preparing.push(card);
      else waiting.push(card);
    });

    // Ordenar por prioridad local (si existe)
    const sortByLocal = (list: any[]) => {
      if (localOrderIds.length === 0) return list;
      const indexOf = (id: string) => {
        const i = localOrderIds.indexOf(id);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      return [...list].sort((a, b) => indexOf(a.id) - indexOf(b.id));
    };

    return {
      waiting: sortByLocal(waiting),
      preparing: sortByLocal(preparing),
    } as Record<BoardColumnKey, any[]>;
  }, [orders, localOrderIds]);

  const handlePinTop = (orderId: string) => {
    setLocalOrderIds(prev => {
      const rest = prev.filter(id => id !== orderId);
      return [orderId, ...rest];
    });
  };

  const timeFromNow = (iso: string) => {
    try {
      const d = new Date(iso);
      const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
      return `${mins} min`;
    } catch {
      return '';
    }
  };

  const loadOrderItems = async (orderId: number) => {
    try {
      setLoadingItems(prev => ({ ...prev, [orderId]: true }));
      const [platosRes, bebidasRes, toppingsRes] = await Promise.all([
        supabase.from('ordenes_platos').select('platos(name)').eq('orden_id', orderId),
        supabase.from('ordenes_bebidas').select('bebidas(name)').eq('orden_id', orderId),
        supabase.from('ordenes_toppings').select('toppings(name)').eq('orden_id', orderId),
      ]);

      const list: { nombre: string; cantidad: number; tipo: 'plato' | 'bebida' | 'topping' }[] = [];

      const pushGrouped = (names: (string | null | undefined)[], tipo: 'plato' | 'bebida' | 'topping') => {
        const map = new Map<string, number>();
        names.forEach(n => {
          const key = (n || 'Producto').trim();
          map.set(key, (map.get(key) || 0) + 1);
        });
        Array.from(map.entries()).forEach(([nombre, cantidad]) => list.push({ nombre, cantidad, tipo }));
      };

      pushGrouped((platosRes.data || []).map((r: any) => r.platos?.name), 'plato');
      pushGrouped((bebidasRes.data || []).map((r: any) => r.bebidas?.name), 'bebida');
      pushGrouped((toppingsRes.data || []).map((r: any) => r.toppings?.name), 'topping');

      setOrderItems(prev => ({ ...prev, [orderId]: list }));
    } catch (e) {
      console.error('Error cargando items de orden', e);
    } finally {
      setLoadingItems(prev => ({ ...prev, [orderId]: false }));
    }
  };

  // Cargar productos para todas las órdenes visibles (una sola vez por orden)
  useEffect(() => {
    const ids = [...board.waiting, ...board.preparing]
      .map(c => c.nid)
      .filter(Boolean) as number[];
    ids.forEach(id => {
      const alreadyLoaded = orderItems[id]?.length;
      const alreadyLoading = loadingItems[id];
      if (!alreadyLoaded && !alreadyLoading) {
        loadOrderItems(id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.waiting.length, board.preparing.length]);

  const updateStatus = async (nid: number | null, next: 'Cocina' | 'Camino') => {
    if (!nid) return;
    try {
      await orderStatusService.updateOrderStatus({ orderId: nid.toString(), newStatus: next });
      toast({ title: 'Estado actualizado', description: `Orden ${nid} → ${next}` });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message || 'No se pudo actualizar el estado', variant: 'destructive' });
    }
  };

  const TypeBadge = ({ type }: { type: string }) => {
    if (type === 'pickup' || type === 'PARA LLEVAR') {
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-200">
          <Package className="h-3 w-3 mr-1" /> Para llevar
        </Badge>
      );
    }
    if (type === 'dine_in' || type === 'EN SEDE') {
      return (
        <Badge className="bg-purple-100 text-purple-800 border-purple-200">
          <Store className="h-3 w-3 mr-1" /> En sede
        </Badge>
      );
    }
    return (
      <Badge className="bg-blue-100 text-blue-800 border-blue-200">
        <MapPin className="h-3 w-3 mr-1" /> Domicilio
      </Badge>
    );
  };

  const OrderCard = ({ card }: { card: any }) => {
    return (
      <Card className="border border-gray-200 hover:shadow-sm transition-all">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-bold tracking-wide">
              {card.id}
            </CardTitle>
            <TypeBadge type={card.type} />
          </div>
          <div className="mt-1 text-sm text-muted-foreground flex items-center gap-2">
            <Clock className="h-4 w-4" /> {timeFromNow(card.created_at)}
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-gray-500" />
              <span className="font-medium">{card.cliente}</span>
            </div>
            {card.mesa && (
              <div className="flex items-center gap-2">
                <Utensils className="h-4 w-4 text-gray-500" />
                <span>Mesa {card.mesa}</span>
              </div>
            )}
            {card.direccion && card.type !== 'dine_in' && (
              <div className="flex items-start gap-2">
                <MapPin className="h-4 w-4 text-gray-500 mt-0.5" />
                <span className="text-xs leading-snug">{card.direccion}</span>
              </div>
            )}
            <Separator className="my-2" />
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Productos</span>
              <span className="font-semibold">{card.itemsCount ?? '-'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Cubiertos</span>
              <span className="font-semibold">{card.cubiertos}</span>
            </div>
          </div>
          <div className="pt-3 flex items-center gap-3">
            {card.status !== 'Cocina' && (
              <button
                className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                onClick={() => updateStatus(card.nid, 'Cocina')}
              >
                <Play className="h-3 w-3" /> Pasar a preparación
              </button>
            )}
            {card.status === 'Cocina' && (
              <button
                className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded bg-green-600 text-white hover:bg-green-700"
                onClick={() => updateStatus(card.nid, 'Camino')}
              >
                <Check className="h-3 w-3" /> Marcar listo
              </button>
            )}
            <button
              className="text-xs text-blue-600 hover:underline"
              onClick={() => handlePinTop(card.id)}
            >
              Fijar arriba
            </button>
          </div>
          {card.nid && (
            <div className="mt-3 border rounded p-2 bg-muted/30">
              {loadingItems[card.nid] && !(orderItems[card.nid]?.length) ? (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Cargando productos...
                </div>
              ) : (orderItems[card.nid] || []).length === 0 ? (
                <div className="text-xs text-muted-foreground">Sin productos</div>
              ) : (
                <div className="space-y-1 text-sm">
                  {(orderItems[card.nid] || []).map((it, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span className={it.tipo === 'topping' ? 'text-orange-700' : ''}>
                        {it.tipo === 'topping' ? 'Extra • ' : ''}{it.nombre}
                      </span>
                      <span className="font-medium">x{it.cantidad}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const Column = ({ title, items }: { title: string; items: any[] }) => (
    <div className="flex-1 min-w-[320px] bg-muted/30 rounded-lg border">
      <div className="px-4 py-3 border-b flex items-center justify-between">
        <div className="font-semibold tracking-wide">{title}</div>
        <Badge variant="secondary">{items.length}</Badge>
      </div>
      <ScrollArea className="h-[calc(100vh-220px)] px-3 py-3">
        <div className="grid gap-3">
          {items.map((c) => (
            <OrderCard key={c.id} card={c} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Brand Header minimal para consistencia visual */}
      <div className="bg-brand-primary text-white shadow">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="/lovable-uploads/96fc454f-e0fb-40ad-9214-85dcb21960e5.png"
              alt="Ajiaco & Frijoles Logo"
              className="h-10 w-10 rounded-full bg-brand-secondary p-1"
            />
            <div>
              <h1 className="text-xl font-bold">Ajiaco & Frijoles</h1>
              <p className="text-brand-secondary text-xs">Pantalla de Cocina</p>
            </div>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-white/90">
              <Loader2 className="h-4 w-4 animate-spin" /> Actualizando
            </div>
          )}
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 space-y-4">
        <div className="flex gap-4">
          <Column title="En espera" items={board.waiting} />
          <Column title="En preparación" items={board.preparing} />
        </div>
      </div>

      {/* Footer consistente */}
      <div className="bg-brand-primary text-white mt-6">
        <div className="container mx-auto p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img 
              src="/lovable-uploads/96fc454f-e0fb-40ad-9214-85dcb21960e5.png" 
              alt="Ajiaco & Frijoles" 
              className="h-8 w-8 rounded-full bg-brand-secondary p-1"
            />
            <span className="text-sm">Ajiaco & Frijoles • Sistema de Gestión de Pedidos</span>
          </div>
          <span className="text-xs text-brand-secondary">© {new Date().getFullYear()}</span>
        </div>
      </div>
    </div>
  );
};


