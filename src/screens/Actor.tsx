// Actor: foto, biografía y su filmografía de TMDB, solo los títulos que el servidor tiene.
// Al elegir un título se abre su ficha.
import React, { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Person, personWithCatalog } from '../api/tmdb';
import { Button, Message, Spinner } from '../components/ui';
import { ymd } from '../lib/util';
import { useAppState } from '../state';
import { C, px, themed } from '../theme';
import { t } from '../lib/i18n';
import { ItemGrid } from './Grid';

function birth(p: Person): string {
  const m = p.birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? t('Nació el {d}', { d: ymd(+m[1], +m[2], +m[3]) }) : '';
  return [d, p.place].filter(Boolean).join(' · ');
}

// trozos de la biografía para recorrerla con el control (cada uno toma el foco y la lista baja)
function chunks(bio: string): string[] {
  const out: string[] = [];
  for (const par of bio.split(/\n+/).map(x => x.trim()).filter(Boolean)) {
    let cur = '';
    for (const sen of par.match(/[^.!?]+[.!?]*\s*/g) || [par]) {
      if (cur && (cur + sen).length > 320) {
        out.push(cur.trim());
        cur = '';
      }
      cur += sen;
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out;
}

function Chunk({ text }: { text: string }) {
  const [f, setF] = useState(false);
  return (
    <Pressable focusable onFocus={() => setF(true)} onBlur={() => setF(false)} style={[s.chunk, f && s.chunkF]}>
      <Text style={s.modalText}>{text}</Text>
    </Pressable>
  );
}

export default function Actor({ personId, name }: { personId: number; name: string }) {
  const st = useAppState();
  const [person, setPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(true);
  const [bioOpen, setBioOpen] = useState(false);

  // se vuelve a emparejar si el catálogo termina de cargar mientras se ve la página
  useEffect(() => {
    let alive = true;
    setLoading(true);
    personWithCatalog(personId)
      .then(p => alive && setPerson(p))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [personId, st.catalogRev]);

  if (loading && !person) return <Spinner label={t('Buscando la filmografía de {x}', { x: name })} />;
  if (!person) return <Message text={t('No se encontró información de {x}.', { x: name })} />;

  const header = (
    <View style={s.head}>
      {person.photo ? <Image source={{ uri: person.photo }} style={s.photo} resizeMode="cover" /> : <View style={s.photo} />}
      <View style={s.txt}>
        <Text style={s.name} numberOfLines={1}>
          {person.name}
        </Text>
        {birth(person) ? <Text style={s.meta}>{birth(person)}</Text> : null}
        {/* la biografía tiene su espacio (3 líneas) y la completa se lee aparte: nunca tapa la filmografía */}
        {person.bio ? (
          <Text style={s.bio} numberOfLines={3}>
            {person.bio}
          </Text>
        ) : null}
        {person.bio.length > 180 ? (
          <View style={s.more}>
            <Button label={t('Leer biografía')} small onPress={() => setBioOpen(true)} />
          </View>
        ) : null}
        <Text style={s.h2}>
          {t('Disponible en tu servidor')} <Text style={s.count}>{person.items.length ? '· ' + person.items.length : ''}</Text>
        </Text>
        {!person.items.length ? <Text style={s.meta}>{t('Este servidor no tiene películas ni series de {x}.', { x: person.name })}</Text> : null}
      </View>
    </View>
  );

  return (
    <View style={s.root}>
      <ItemGrid items={person.items} header={header} />
      <Modal visible={bioOpen} transparent animationType="fade" onRequestClose={() => setBioOpen(false)}>
        <View style={s.modalBack}>
          <View style={s.modalCard}>
            <Text style={s.modalName}>{person.name}</Text>
            <ScrollView style={s.modalScroll}>
              {chunks(person.bio).map((c, i) => (
                <Chunk key={i} text={c} />
              ))}
            </ScrollView>
            <View style={s.modalBtns}>
              <Button label={t('Cerrar')} primary preferred last onPress={() => setBioOpen(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg, paddingTop: px(60) },
    head: { flexDirection: 'row', marginBottom: px(30) },
    photo: { width: px(240), height: px(360), borderRadius: px(10), backgroundColor: C.card, marginRight: px(40) },
    txt: { flex: 1, maxWidth: px(1300), justifyContent: 'flex-end' },
    name: { color: C.text, fontSize: px(60), fontWeight: '900' },
    meta: { color: C.sub, fontSize: px(26), marginTop: px(8) },
    bio: { color: C.text, fontSize: px(26), lineHeight: px(38), marginTop: px(16), maxHeight: px(114), overflow: 'hidden' },
    more: { flexDirection: 'row', marginTop: px(12) },
    modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
    modalCard: { backgroundColor: C.card, width: px(1100), maxHeight: px(860), borderRadius: px(16), padding: px(50) },
    modalName: { color: C.text, fontSize: px(40), fontWeight: '900', marginBottom: px(20) },
    modalScroll: { maxHeight: px(580), marginBottom: px(30) },
    chunk: { padding: px(12), borderRadius: px(8), borderWidth: px(2), borderColor: 'transparent' },
    chunkF: { borderColor: C.sub },
    modalText: { color: C.text, fontSize: px(28), lineHeight: px(42) },
    modalBtns: { flexDirection: 'row', justifyContent: 'flex-end' },
    h2: { color: C.text, fontSize: px(36), fontWeight: '800', marginTop: px(26) },
    count: { color: C.sub, fontWeight: '400' },
  }),
);
