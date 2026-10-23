import { BadRequestError, ConflictError, NotFoundError, UnprocessableError } from "../../../shared/errors/AppError";
import { plotPrice } from "../game.constants";
import type { TilesInput } from "../game.schemas";
import { act, addItem, changeMoney, findPlot, itemCount, removeItem, tileKey } from "./game-tx";

// Cada ação do jogador (arar, plantar, colher, comprar, vender) é validada e aplicada aqui, com os preços
// e tempos do catálogo no banco. Convenção dos erros:
//   400 referência inválida (planta/item que não existe) · 404 terreno/árvore que não existe
//   409 o alvo já está no estado pedido (já arado, terreno já é seu)
//   422 uma regra do jogo não deixa (sem dinheiro, sem semente, planta verde...)

// Ara os tiles que ainda são terra (os outros ficam como estão)
export const till = (userId: string, input: TilesInput) =>
  act(userId, async (tx, save) => {
    const plot = await findPlot(tx, save.id, input.x, input.y);
    const used = new Set(plot.tiles.map(tileKey));
    const soil = input.tiles.filter((t) => !used.has(tileKey(t)));
    if (soil.length === 0) throw new ConflictError("Esses tiles já estão arados", "TILES_ALREADY_TILLED");
    await tx.tile.createMany({ data: soil.map((t) => ({ plotId: plot.id, row: t.row, col: t.col, state: "tilled" as const })) });
  });

// Planta nos tiles arados, na ordem pedida, enquanto houver semente
export const plant = (userId: string, input: TilesInput & { cropId: string }) =>
  act(userId, async (tx, save, now) => {
    const crop = await tx.crop.findUnique({ where: { id: input.cropId } });
    if (!crop) throw new BadRequestError("Planta desconhecida", "UNKNOWN_CROP");
    const plot = await findPlot(tx, save.id, input.x, input.y);
    const byKey = new Map(plot.tiles.map((t) => [tileKey(t), t]));
    const tilled = input.tiles.filter((t) => byKey.get(tileKey(t))?.state === "tilled");
    if (tilled.length === 0) throw new UnprocessableError("Are a terra antes de plantar", "TILES_NOT_TILLED");

    const have = await itemCount(tx, save.id, crop.seedItemId);
    if (have === 0) throw new UnprocessableError(`Você não tem sementes de ${crop.name.toLowerCase()}`, "NO_SEEDS");
    const chosen = tilled.slice(0, have);
    await tx.tile.updateMany({
      where: { plotId: plot.id, OR: chosen.map((t) => ({ row: t.row, col: t.col })) },
      data: { state: "planted", cropId: crop.id, plantedAt: new Date(now) },
    });
    await removeItem(tx, save.id, crop.seedItemId, chosen.length, have);
  });

// Colhe os tiles com planta madura (crescimento conferido pelo relógio do servidor)
export const harvest = (userId: string, input: TilesInput) =>
  act(userId, async (tx, save, now) => {
    const plot = await findPlot(tx, save.id, input.x, input.y);
    const byKey = new Map(plot.tiles.map((t) => [tileKey(t), t]));
    const ripe = input.tiles
      .map((t) => byKey.get(tileKey(t)))
      .filter((t) => t?.state === "planted" && t.crop && t.plantedAt && now - t.plantedAt.getTime() >= t.crop.growSeconds * 1000);
    if (ripe.length === 0) throw new UnprocessableError("A planta ainda não está madura", "CROP_NOT_RIPE");

    await tx.tile.updateMany({
      where: { plotId: plot.id, OR: ripe.map((t) => ({ row: t!.row, col: t!.col })) },
      data: { state: "tilled", cropId: null, plantedAt: null },
    });
    await changeMoney(tx, save.id, ripe.reduce((sum, t) => sum + t!.crop!.harvestPrice, 0));
  });

// Compra sementes; se o dinheiro não dá para todas, compra as que dá
export const buySeed = (userId: string, input: { cropId: string; quantity: number }) =>
  act(userId, async (tx, save) => {
    const crop = await tx.crop.findUnique({ where: { id: input.cropId }, include: { seedItem: true } });
    const price = crop?.seedItem.buyPrice;
    if (!crop || price == null) throw new BadRequestError("Semente desconhecida", "UNKNOWN_SEED");
    const n = price === 0 ? input.quantity : Math.min(input.quantity, Math.floor(save.money / price));
    if (n < 1) throw new UnprocessableError("Dinheiro insuficiente", "INSUFFICIENT_FUNDS");
    await changeMoney(tx, save.id, -price * n);
    await addItem(tx, save.id, crop.seedItemId, n);
  });

// Vende frutas do inventário (todas, se a quantidade não vier)
export const sellFruit = (userId: string, input: { itemId: string; quantity?: number }) =>
  act(userId, async (tx, save) => {
    const item = await tx.item.findUnique({ where: { id: input.itemId } });
    if (!item || item.sellPrice == null) throw new BadRequestError("Esse item não se vende", "ITEM_NOT_SELLABLE");
    const have = await itemCount(tx, save.id, item.id);
    const n = Math.min(input.quantity ?? have, have);
    if (n < 1) throw new UnprocessableError(`Você não tem ${item.name.toLowerCase()}`, "NOT_ENOUGH_ITEMS");
    await removeItem(tx, save.id, item.id, n, have);
    await changeMoney(tx, save.id, item.sellPrice * n);
  });

// Compra um terreno vazio colado (4 direções) a um que o jogador já tem
export const buyPlot = (userId: string, input: { x: number; y: number }) =>
  act(userId, async (tx, save) => {
    const plots = await tx.plot.findMany({ where: { saveId: save.id }, select: { x: true, y: true } });
    if (plots.some((p) => p.x === input.x && p.y === input.y)) throw new ConflictError("Esse terreno já é seu", "PLOT_ALREADY_OWNED");
    const touches = plots.some((p) => Math.abs(p.x - input.x) + Math.abs(p.y - input.y) === 1);
    if (!touches) throw new UnprocessableError("Só dá para comprar um terreno ao lado de um seu", "PLOT_NOT_ADJACENT");
    const price = plotPrice(plots.length);
    if (save.money < price) throw new UnprocessableError("Dinheiro insuficiente", "INSUFFICIENT_FUNDS");
    await tx.plot.create({ data: { saveId: save.id, x: input.x, y: input.y } });
    await changeMoney(tx, save.id, -price);
  });

// Colhe as frutas de uma árvore; ela só repõe depois do tempo de rebrota
export const harvestTree = (userId: string, treeId: string) =>
  act(userId, async (tx, save, now) => {
    const tree = await tx.tree.findUnique({ where: { id: treeId } });
    if (!tree) throw new NotFoundError("Árvore não encontrada", "TREE_NOT_FOUND");
    const where = { saveId_treeId: { saveId: save.id, treeId } };
    const last = await tx.treeHarvest.findUnique({ where });
    if (last && now - last.harvestedAt.getTime() < tree.regrowSeconds * 1000) {
      throw new UnprocessableError("A árvore ainda não repôs as frutas", "TREE_NOT_READY");
    }
    await tx.treeHarvest.upsert({ where, create: { saveId: save.id, treeId, harvestedAt: new Date(now) }, update: { harvestedAt: new Date(now) } });
    await addItem(tx, save.id, tree.fruitItemId, tree.fruitsPerHarvest);
  });
