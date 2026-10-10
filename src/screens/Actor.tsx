// Actor: foto, biografía y su filmografía de TMDB, solo los títulos que el servidor tiene.
// Al elegir un título se abre su ficha.
import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Person, personWithCatalog } from '../api/tmdb';
import { Message, Spinner } from '../components/ui';
import { useAppState } from '../state';
import { C, px, themed } from '../theme';
import { ItemGrid } from './Grid';

function birth(p: Person): string {
  const m = p.birthday.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? 'Nació el ' + m[3] + '/' + m[2] + '/' + m[1] : '';
  return [d, p.place].filter(Boolean).join(' · ');
}

export default function Actor({ personId, name }: { personId: number; name: string }) {
  const st = useAppState();
  const [person, setPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading && !person) return <Spinner label={'Buscando la filmografía de ' + name} />;
  if (!person) return <Message text={'No se encontró información de ' + name + '.'} />;

  const header = (
    <View style={s.head}>
      {person.photo ? <Image source={{ uri: person.photo }} style={s.photo} resizeMode="cover" /> : <View style={s.photo} />}
      <View style={s.txt}>
        <Text style={s.name} numberOfLines={1}>
          {person.name}
        </Text>
        {birth(person) ? <Text style={s.meta}>{birth(person)}</Text> : null}
        {person.bio ? (
          <Text style={s.bio} numberOfLines={6}>
            {person.bio}
          </Text>
        ) : null}
        <Text style={s.h2}>
          Disponible en tu servidor <Text style={s.count}>{person.items.length ? '· ' + person.items.length : ''}</Text>
        </Text>
        {!person.items.length ? <Text style={s.meta}>Este servidor no tiene películas ni series de {person.name}.</Text> : null}
      </View>
    </View>
  );

  return (
    <View style={s.root}>
      <ItemGrid items={person.items} header={header} />
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
    bio: { color: C.text, fontSize: px(26), lineHeight: px(38), marginTop: px(16) },
    h2: { color: C.text, fontSize: px(36), fontWeight: '800', marginTop: px(26) },
    count: { color: C.sub, fontWeight: '400' },
  }),
);
