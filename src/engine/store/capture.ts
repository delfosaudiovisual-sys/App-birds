import { saveSighting, type Sighting } from './db';

/**
 * Le a localizacao sem NUNCA travar quem chamou.
 *
 * A opcao `timeout` da Geolocation API so passa a valer depois que a permissao
 * e concedida: enquanto o navegador exibe o pedido de permissao, uma promessa
 * baseada so em getCurrentPosition fica pendente indefinidamente. Se o usuario
 * ignora o pedido, ela nunca resolve. Dai a corrida com um limite proprio.
 */
export function currentLocation(timeoutMs = 8000): Promise<Sighting['location'] | undefined> {
  if (!navigator.geolocation) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: Sighting['location'] | undefined) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(value);
    };

    const timer = window.setTimeout(() => finish(undefined), timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (position) =>
        finish({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }),
      () => finish(undefined),
      { timeout: timeoutMs, maximumAge: 60_000, enableHighAccuracy: false },
    );
  });
}

/**
 * Grava o registro IMEDIATAMENTE e so depois complementa com a localizacao.
 *
 * O GPS de um celular no mato pode levar varios segundos, e nada disso deve
 * ficar entre o toque do usuario e o passaro entrar na pokedex. Se as
 * coordenadas chegarem, o registro e regravado com elas e `onUpdated` avisa a
 * tela; se nao chegarem, o registro ja esta salvo do mesmo jeito.
 */
export async function persistSighting(
  sighting: Sighting,
  withLocation: boolean,
  onUpdated?: () => void,
): Promise<void> {
  await saveSighting(sighting);

  if (!withLocation) return;

  void currentLocation()
    .then(async (location) => {
      if (!location) return;
      await saveSighting({ ...sighting, location });
      onUpdated?.();
    })
    .catch(() => {
      // o registro principal ja foi gravado; falha ao anexar GPS e irrelevante
    });
}
