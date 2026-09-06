import { useEffect, useState } from 'react';
import type { Species } from '../data/types';
import type { StoredPhoto } from '../engine/store/db';
import { getReferencePhoto } from '../engine/photos/photoStore';
import { BirdArt } from './BirdArt';

/**
 * Imagem de uma especie, resolvida numa cadeia de tres degraus:
 *
 *   1. a foto do PROPRIO usuario, quando ele ja registrou essa ave. E a melhor
 *      opcao por dois motivos: nao depende de rede nem de licenca de terceiros,
 *      e transforma a pokedex numa colecao de fato — o que voce viu, do jeito
 *      que voce viu.
 *   2. a foto de referencia da Wikimedia, baixada uma unica vez e guardada no
 *      aparelho, exibida com autor e licenca.
 *   3. a ilustracao vetorial, que nunca falha e funciona sem rede nenhuma.
 *
 * O degrau 3 aparece de imediato enquanto o 2 carrega, entao a tela nunca fica
 * vazia esperando a rede.
 */

export interface SpeciesImageProps {
  species: Species;
  /** foto do usuario (data URL) vinda dos registros da pokedex */
  userPhoto?: string;
  /** especie ainda nao descoberta: mostra silhueta e nao busca nada */
  locked?: boolean;
  /** desliga a busca de foto de referencia */
  allowReference?: boolean;
  /** exibe o credito de licenca abaixo da imagem */
  showCredit?: boolean;
  className?: string;
}

export function SpeciesImage({
  species,
  userPhoto,
  locked = false,
  allowReference = true,
  showCredit = false,
  className,
}: SpeciesImageProps) {
  const [reference, setReference] = useState<StoredPhoto | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  const wantsReference = allowReference && !locked && !userPhoto;

  useEffect(() => {
    if (!wantsReference) {
      setReference(null);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    void getReferencePhoto(species.id, { signal: controller.signal }).then((photo) => {
      if (!cancelled) setReference(photo);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [species.id, wantsReference]);

  // O object URL precisa ser revogado, senao cada ficha aberta vaza memoria.
  useEffect(() => {
    if (!reference) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(reference.blob);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [reference]);

  if (!locked && userPhoto) {
    return (
      <figure className={className} style={{ margin: 0, height: '100%' }}>
        <img src={userPhoto} alt={`Sua foto de ${species.commonName}`} />
        {showCredit && <figcaption className="photo-credit">Sua foto</figcaption>}
      </figure>
    );
  }

  if (!locked && objectUrl && reference) {
    return (
      <figure className={className} style={{ margin: 0, height: '100%' }}>
        <img src={objectUrl} alt={`Foto de ${species.commonName}`} />
        {showCredit && (
          <figcaption className="photo-credit">
            {reference.attribution.author} ·{' '}
            {reference.attribution.licenseUrl ? (
              <a href={reference.attribution.licenseUrl} target="_blank" rel="noreferrer noopener">
                {reference.attribution.license}
              </a>
            ) : (
              reference.attribution.license
            )}
            {reference.attribution.sourceUrl && (
              <>
                {' · '}
                <a href={reference.attribution.sourceUrl} target="_blank" rel="noreferrer noopener">
                  Wikimedia Commons
                </a>
              </>
            )}
          </figcaption>
        )}
      </figure>
    );
  }

  return <BirdArt species={species} locked={locked} className={className} />;
}
