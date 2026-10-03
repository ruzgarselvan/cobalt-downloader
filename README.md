# Cobalt İndirici

Chromium tabanlı tarayıcılar (Helium, Chrome, Brave, Arc, Edge…) için küçük bir eklenti. Bir video linki kopyaladığında sağ altta bir pencere açılır. **İndir** ya da **Sadece ses** dersen dosya, [cobalt.directory](https://cobalt.directory)'de çalışan bir [cobalt](https://github.com/imputnet/cobalt) instance'ı üzerinden İndirilenler klasörüne iner.

## Kurulum

1. Bu klasörü indir (ya da `git clone`).
2. Tarayıcıda `chrome://extensions` adresini aç ve sağ üstten **Geliştirici modu**nu aç.
3. **Paketlenmemiş öğe yükle** düğmesine bas ve bu klasörü seç.

## Nasıl çalışır

- **Algılama:** Eklenti panoyu saniyede bir yerel olarak okur. Adres çubuğundan ya da sayfadan kopyalanan linkleri algılar. YouTube, TikTok, Instagram, X, Reddit, Vimeo, SoundCloud, Twitch klipleri, Bluesky ve cobalt'ın desteklediği diğer servisler tanınır.
- **İndirme:** İndir'e bastığında link, cobalt.directory'deki Turnstile'sız instance'lara puan sırasıyla gönderilir ve ilk başarılı yanıt indirilir. Liste 6 saatte bir yenilenir.
- **Pencere:** Sadece kopyalamayı yaptığın, o an önde olan sekmede çıkar. Başka bir uygulamada kopyaladığında çıkmaz. Hiçbir düğmeye basmazsan 3 saniye sonra kaybolur.
- **TorBox (isteğe bağlı):** Seçenekler'e TorBox API anahtarını girersen:
  - Magnet linkleri ve Mega, 1fichier, Google Drive gibi dosya linkleri de algılanır ve TorBox ile indirilir. Birden çok dosyalı torrentler kendi klasörüne iner.
  - TorBox'ın önbelleğinde olmayan içerikler önce TorBox tarafından indirilir. Eklenti 30 saniyede bir kontrol eder, hazır olunca dosyaları indirip bildirim gösterir.
  - Video linkleri yine önce cobalt'a gider, cobalt indiremezse TorBox denenir.
- **Yedek:** Turnstile'sız instance'lar linki indiremezse, en yüksek puanlı Turnstile'lı instance'ın sitesi link dolu halde açılır. Doğrulama orada senin tarayıcında normal şekilde yapılır.
- **Araç çubuğu simgesi:** Simgeye tıklarsan açık sekmedeki video için aynı pencere açılır.
- **Yeni sekme gibi sayfalar:** Tarayıcı bu sayfalarda eklentiye izin vermediği için pencere çıkmaz.

## Ayarlar

Eklentinin **Seçenekler** sayfasında şunlar var:
- Pano izlemeyi açma/kapama
- Video kalitesi
- Kendi cobalt instance'ın ve API anahtarın
- Güncel instance listesi

## Gizlilik

Pano yalnızca tarayıcının içinde okunur. Kopyaladığın hiçbir şey dışarı gönderilmez. Bir link, sadece sen İndir'e bastığında seçilen cobalt instance'ına gider. Eklentinin bunun dışında tek yaptığı ağ isteği, instance listesi için cobalt.directory'ye yaptığı istektir.

## Bilinen sınırlar

- Turnstile'sız instance sayısı az. Şu an 2 tane var, bazı servislerde ikisi de başarısız olabilir. O durumda yedek yol devreye girer.
- cobalt.directory'nin açık bir API'si yok, liste sayfanın HTML'inden okunuyor. Site tasarımı değişirse ayrıştırma bozulabilir. Bu durumda Seçenekler'den kendi instance'ını girebilirsin.

## Lisans

MIT. cobalt.directory, cobalt ve TorBox ile resmi bir bağlantısı yoktur.
