const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const session = require("express-session"); 
const MySQLStore = require('express-mysql-session')(session); 
const app = express();


const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "Gk485226.",
    database: "finans_yonetimi"
});


const sessionStore = new MySQLStore({}, db); 

app.set("view engine", "ejs");
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
    key: 'finova_user_sid',
    secret: "finova_secret",
    store: sessionStore, 
    resave: false,
    saveUninitialized: false
}));


db.connect((err) => {
    if(err){
        console.log("Bağlantı hatası:", err);
        return;
    }
    console.log("MySQL bağlantısı başarılı!");
});


app.get("/", (req, res) => {
    if (!req.session.user) {
        return res.render("landing");
    }

    const kullaniciId = req.session.user.id;

    const hesaplarSql = "SELECT * FROM Hesaplar WHERE kullanici_id = ?";
    
    db.query(hesaplarSql, [kullaniciId], (err, hesaplar) => {
        if (err) {
            console.log("Hesaplar çekilirken hata oluştu:", err);
            return res.status(500).send("Veritabanı hatası");
        }

        const islemlerSql = `
            SELECT Islemler.*, Kategoriler.kategori_adi, Hesaplar.hesap_adi 
            FROM Islemler 
            LEFT JOIN Kategoriler ON Islemler.kategori_id = Kategoriler.kategori_id
            LEFT JOIN Hesaplar ON Islemler.hesap_id = Hesaplar.hesap_id
            WHERE Islemler.kullanici_id = ?
            ORDER BY Islemler.tarih DESC, Islemler.islem_id DESC
        `;

        db.query(islemlerSql, [kullaniciId], (err, islemler) => {
            if (err) {
                console.log("İşlemler çekilirken hata oluştu:", err);
                return res.status(500).send("Veritabanı hatası");
            }

            res.render("index", {
                user: req.session.user,
                islemler: islemler,
                hesaplar: hesaplar 
            });
        });
    });
});


app.get("/register", (req, res) => {

    res.render("register");

});


app.get("/login", (req, res) => {

    res.render("login", {

        hata: null

    });

});


app.post("/register", async (req, res) => {
    const { ad, email, sifre } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(sifre, 10);
        const sql = "INSERT INTO Kullanicilar (ad, email, sifre) VALUES (?, ?, ?)";

        db.query(sql, [ad, email, hashedPassword], (err, result) => {
            if (err) {
                console.log(err);
                return res.render("register", { hata: "Bu email zaten kayıtlı!" });
            }

            const yeniKullaniciId = result.insertId;

            const hesaplarSql = `
                INSERT INTO Hesaplar (kullanici_id, hesap_adi, bakiye) VALUES 
                (?, '💵 Nakit', 0),
                (?, '🏦 Banka', 0),
                (?, '💳 Kredi Kartı', 0)
            `;

            db.query(hesaplarSql, [yeniKullaniciId, yeniKullaniciId, yeniKullaniciId], (err, her) => {
                if (err) {
                    console.log("Kullanıcıya özel otomatik hesaplar oluşturulamadı:", err);
                }
                
                res.redirect("/login");
            });
        });
    } catch {
        res.status(500).send("Sunucu hatası");
    }
});


app.post("/login", (req, res) => {

    const {

        email,
        sifre

    } = req.body;

    const sql = `
    SELECT * FROM Kullanicilar
    WHERE email = ?
    `;

    db.query(sql, [email], async (err, results) => {

        if(err){

            console.log(err);

            return;

        }

        if(results.length === 0){

            return res.render("login", {

                hata: "Kullanıcı bulunamadı"

            });

        }

        const user = results[0];

        const dogruMu = await bcrypt.compare(

            sifre,
            user.sifre

        );

        if(!dogruMu){

            return res.render("login", {

                hata: "Şifre yanlış"

            });

        }

        req.session.user = {

            id: user.kullanici_id,

            ad: user.ad,

            email: user.email

        };

        res.redirect("/dashboard");

    });

});


app.get("/logout", (req, res) => {

    req.session.destroy(() => {

        res.redirect("/");

    });

});


app.get("/dashboard", (req, res) => {
    if(!req.session.user){
        return res.redirect("/");
    }

    const sqlHesaplar = "SELECT * FROM Hesaplar WHERE kullanici_id = ?";
    
    db.query(sqlHesaplar, [req.session.user.id], (errHesap, hesaplar) => {
        if (errHesap) {
            console.log("Hesaplar çekilirken hata oluştu:", errHesap);
            return res.redirect("/");
        }

        const toplamBakiye = hesaplar.reduce((toplam, hesap) => toplam + parseFloat(hesap.bakiye || 0), 0);

        const islemlerSql = `
            SELECT
                Islemler.*,
                Kategoriler.ad AS kategori_adi,
                Hesaplar.hesap_adi AS hesap_adi
            FROM Islemler
            LEFT JOIN Kategoriler ON Islemler.kategori_id = Kategoriler.kategori_id
            LEFT JOIN Hesaplar ON Islemler.hesap_id = Hesaplar.hesap_id
            WHERE Islemler.kullanici_id = ?
            ORDER BY Islemler.tarih DESC, Islemler.islem_id DESC
            LIMIT 10
        `;

        const gelirSql = `
            SELECT SUM(tutar) AS toplamGelir
            FROM Islemler
            WHERE kullanici_id = ? AND tur = 'gelir'
        `;

        const giderSql = `
            SELECT SUM(tutar) AS toplamGider
            FROM Islemler
            WHERE kullanici_id = ? AND tur = 'gider'
        `;

        db.query(islemlerSql, [req.session.user.id], (err, islemler) => {
            if(err){
                console.log(err);
                return;
            }

            db.query(gelirSql, [req.session.user.id], (err, gelirResult) => {
                if(err){
                    console.log(err);
                    return;
                }

                db.query(giderSql, [req.session.user.id], (err, giderResult) => {
                    if(err){
                        console.log(err);
                        return;
                    }

                    const toplamGelir = gelirResult[0].toplamGelir || 0;
                    const toplamGider = giderResult[0].toplamGider || 0;

                    let tasarrufOrani = 0;
                    if(toplamGelir > 0){
                        tasarrufOrani = ((toplamGelir - toplamGider) / toplamGelir) * 100;
                    }

                    res.render("index", {
                        islemler: islemler,
                        user: req.session.user,
                        toplamGelir: toplamGelir,
                        toplamGider: toplamGider,
                        toplamBakiye: toplamBakiye.toFixed(2), 
                        tasarrufOrani: tasarrufOrani.toFixed(1),
                        hesaplar: hesaplar
                    });
                });
            });
        });
    });
});


app.post("/ekle", (req, res) => {
    if(!req.session.user){
        return res.send(`
            <!DOCTYPE html>
            <html lang="tr">
            <head>
                <meta charset="UTF-8">
                <title>Oturum Gerekli</title>
                <style>
                    * { margin:0; padding:0; box-sizing:border-box; }
                    body { background:#0f172a; display:flex; justify-content:center; align-items:center; height:100vh; font-family:Arial; }
                    .modal { background:#111827; padding:40px; border-radius:24px; text-align:center; width:400px; }
                    h1 { color:white; margin-bottom:15px; }
                    p { color:#94a3b8; margin-bottom:30px; }
                    .login-btn { display:inline-block; background:#10b981; color:white; padding:14px 24px; border-radius:12px; text-decoration:none; font-weight:bold; }
                </style>
            </head>
            <body>
                <div class="modal">
                    <h1>Oturum Açmanız Gerekiyor</h1>
                    <p>İşlem eklemek için önce giriş yapmalısınız.</p>
                    <a href="/login" class="login-btn">Oturum Aç</a>
                </div>
            </body>
            </html>
        `);
    }

    const { tutar, tur, hesap_id, kategori_id, tarih, aciklama } = req.body;
    const kullaniciId = req.session.user.id;

    const hesapSorguSql = "SELECT bakiye, hesap_adi FROM Hesaplar WHERE hesap_id = ? AND kullanici_id = ?";
    
    db.query(hesapSorguSql, [hesap_id, kullaniciId], (errHesap, hesapSonuc) => {
        if(errHesap || hesapSonuc.length === 0){
            console.log("Hesap doğrulama hatası:", errHesap);
            return res.redirect("/dashboard");
        }

        const mevcutBakiye = parseFloat(hesapSonuc[0].bakiye || 0);
        const hesapAdi = hesapSonuc[0].hesap_adi;

        if(tur === "gider" && (hesapAdi.includes("Nakit") || hesapAdi.includes("Banka")) && mevcutBakiye < parseFloat(tutar)){
            
            const hataMesaji = "HATA: Yetersiz Bakiye! " + hesapAdi + " hesabınızdaki para eksiye düşemez.";
            
            const sqlHesaplar = "SELECT * FROM Hesaplar WHERE kullanici_id = ?";
            db.query(sqlHesaplar, [kullaniciId], (errH, hesaplar) => {
                
                const islemlerSql = `
                    SELECT Islemler.*, Kategoriler.ad AS kategori_adi, Hesaplar.hesap_adi AS hesap_adi 
                    FROM Islemler 
                    LEFT JOIN Kategoriler ON Islemler.kategori_id = Kategoriler.kategori_id
                    LEFT JOIN Hesaplar ON Islemler.hesap_id = Hesaplar.hesap_id
                    WHERE Islemler.kullanici_id = ? 
                    ORDER BY Islemler.tarih DESC, Islemler.islem_id DESC LIMIT 10
                `;
                
                db.query(islemlerSql, [kullaniciId], (errI, islemler) => {
                    
                    const toplamBakiye = hesaplar.reduce((toplam, hesap) => toplam + parseFloat(hesap.bakiye || 0), 0);

                    return res.render("index", {
                        islemler: islemler,
                        user: req.session.user,
                        toplamGelir: 0, 
                        toplamGider: 0,
                        toplamBakiye: toplamBakiye.toFixed(2),
                        tasarrufOrani: 0,
                        hesaplar: hesaplar,
                        hata: hataMesaji 
                    });
                });
            });
            return;
        }

    
        const insertSql = `
            INSERT INTO Islemler (kullanici_id, hesap_id, kategori_id, tutar, tur, tarih, aciklama)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(insertSql, [kullaniciId, hesap_id, kategori_id, tutar, tur, tarih, aciklama], (errInsert, result) => {
            if(errInsert){
                console.log("İşlem tablosuna yazma hatası:", errInsert);
                return res.redirect("/dashboard");
            }

            let bakiyeSql = "";
            if(tur === "gelir"){
                bakiyeSql = "UPDATE Hesaplar SET bakiye = bakiye + ? WHERE hesap_id = ? AND kullanici_id = ?";
            } else {
                bakiyeSql = "UPDATE Hesaplar SET bakiye = bakiye - ? WHERE hesap_id = ? AND kullanici_id = ?";
            }

            db.query(bakiyeSql, [tutar, hesap_id, kullaniciId], (errBakiye, result2) => {
                if(errBakiye){
                    console.log("Bakiye senkronizasyon hatası:", errBakiye);
                }
                res.redirect("/dashboard");
            });
        });
    });
});


app.get("/sil/:id", (req, res) => {
    if(!req.session.user){
        return res.redirect("/");
    }

    const id = req.params.id;
    const kullaniciId = req.session.user.id; 

    const bulSql = "SELECT tutar, tur, hesap_id FROM Islemler WHERE islem_id = ? AND kullanici_id = ?";
    
    db.query(bulSql, [id, kullaniciId], (errBul, results) => {
        if (errBul || results.length === 0) {
            console.log("Silinecek işlem bulunamadı veya yetkisiz erişim:", errBul);
            return res.redirect("/dashboard");
        }

        const islem = results[0];

        const silSql = "DELETE FROM Islemler WHERE islem_id = ? AND kullanici_id = ?";
        
        db.query(silSql, [id, kullaniciId], (errSil, resultSil) => {
            if (errSil) {
                console.log("İşlem silinirken hata oluştu:", errSil);
                return res.redirect("/dashboard");
            }

            let bakiyeGuncelleSql = "";
            if (islem.tur === "gelir") {
                bakiyeGuncelleSql = "UPDATE Hesaplar SET bakiye = bakiye - ? WHERE hesap_id = ? AND kullanici_id = ?";
            } else {
                bakiyeGuncelleSql = "UPDATE Hesaplar SET bakiye = bakiye + ? WHERE hesap_id = ? AND kullanici_id = ?";
            }

            db.query(bakiyeGuncelleSql, [islem.tutar, islem.hesap_id, kullaniciId], (errBakiye, resultBakiye) => {
                if (errBakiye) {
                    console.log("Bakiye iade edilirken hata oluştu:", errBakiye);
                }

                res.redirect("/dashboard");
            });
        });
    });
});


app.listen(3000, () => {

    console.log("Server çalışıyor:");

    console.log("http://localhost:3000");

});


app.post("/guncelle/:id", (req, res) => {
    if(!req.session.user){
        return res.redirect("/");
    }

    const id = req.params.id;
    const { tutar, tur, kategori_id, hesap_id, tarih, aciklama } = req.body;
    const kullaniciId = req.session.user.id;
    
    const eskiIslemSql = "SELECT tutar, tur, hesap_id FROM Islemler WHERE islem_id = ? AND kullanici_id = ?";
    
    db.query(eskiIslemSql, [id, kullaniciId], (errEski, results) => {
        if (errEski || results.length === 0) {
            console.log("Güncellenecek eski işlem bulunamadı:", errEski);
            return res.redirect("/islemler");
        }

        const eskiIslem = results[0];

        const guncelleSql = `
            UPDATE Islemler
            SET tutar = ?, tur = ?, kategori_id = ?, hesap_id = ?, tarih = ?, aciklama = ?
            WHERE islem_id = ? AND kullanici_id = ?
        `;

        db.query(guncelleSql, [tutar, tur, kategori_id, hesap_id, tarih, aciklama, id, kullaniciId], (errGuncelle, result2) => {
            if (errGuncelle) {
                console.log("İşlem tablosu güncellenirken hata oluştu:", errGuncelle);
                return res.redirect("/islemler");
            }

            let eskiHesapSql = "";
            if (eskiIslem.tur === "gelir") {
                eskiHesapSql = "UPDATE Hesaplar SET bakiye = bakiye - ? WHERE hesap_id = ? AND kullanici_id = ?";
            } else {
                eskiHesapSql = "UPDATE Hesaplar SET bakiye = bakiye + ? WHERE hesap_id = ? AND kullanici_id = ?";
            }

            db.query(eskiHesapSql, [eskiIslem.tutar, eskiIslem.hesap_id, kullaniciId], (errNotr, result3) => {
                if (errNotr) console.log("Eski bakiye nötrlenirken hata oluştu:", errNotr);

                let yeniHesapSql = "";
                if (tur === "gelir") {
                    yeniHesapSql = "UPDATE Hesaplar SET bakiye = bakiye + ? WHERE hesap_id = ? AND kullanici_id = ?";
                } else {
                    yeniHesapSql = "UPDATE Hesaplar SET bakiye = bakiye - ? WHERE hesap_id = ? AND kullanici_id = ?";
                }

                db.query(yeniHesapSql, [tutar, hesap_id, kullaniciId], (errYeni, result4) => {
                    if (errYeni) console.log("Yeni bakiye hesaba yansıtılırken hata oluştu:", errYeni);

                    res.redirect("/islemler");
                });
            });
        });
    });
});

app.get("/butceler", (req, res) => {

    if(!req.session.user){

        return res.redirect("/");

    }

    const seciliAy =
    req.query.ay || new Date().getMonth() + 1;

    const sql = `
    SELECT

    Butceler.*,

    Kategoriler.ad AS kategori_adi,

    (

        SELECT COALESCE(SUM(Islemler.tutar),0)

        FROM Islemler

        WHERE Islemler.kategori_id =
        Butceler.kategori_id

        AND Islemler.kullanici_id = ?

        AND Islemler.tur = 'gider'

        AND MONTH(Islemler.tarih) =
        Butceler.ay

    ) AS harcanan

    FROM Butceler

    INNER JOIN Kategoriler

    ON Butceler.kategori_id =
    Kategoriler.kategori_id

    WHERE Butceler.kullanici_id = ?
    AND Butceler.ay = ?
    `;

    db.query(

        sql,

        [

            req.session.user.id,

            req.session.user.id,

            seciliAy

        ],

        (err, butceler) => {

            if(err){

                console.log(err);

                return;

            }

            res.render("butceler", {

                butceler,
                seciliAy

            });

        }

    );

});
app.post("/butce-ekle", (req, res) => {

    const {

        kategori_id,
        miktar,
        ay

    } = req.body;

    const sql = `
    INSERT INTO Butceler

    (

        kullanici_id,
        kategori_id,
        miktar,
        ay

    )

    VALUES (?, ?, ?, ?)
    `;

    db.query(

        sql,

        [

            req.session.user.id,

            kategori_id,

            miktar,

            ay

        ],

        (err, result) => {

            if(err){

                console.log(err);

                return;

            }

            res.redirect("/butceler");

        }

    );

});
app.get("/analizler", (req, res) => {

    if(!req.session.user){

        return res.redirect("/");

    }

    const ay =
    req.query.ay || new Date().getMonth() + 1;

    const gelirSql = `
    SELECT SUM(tutar) AS toplamGelir

    FROM Islemler

    WHERE kullanici_id = ?
    AND tur = 'gelir'
    AND MONTH(tarih) = ?
    `;

    const giderSql = `
    SELECT SUM(tutar) AS toplamGider

    FROM Islemler

    WHERE kullanici_id = ?
    AND tur = 'gider'
    AND MONTH(tarih) = ?
    `;

    const kategoriSql = `
    SELECT

    Kategoriler.ad AS kategori_adi,
    SUM(Islemler.tutar) AS toplam

    FROM Islemler

    INNER JOIN Kategoriler

    ON Islemler.kategori_id = Kategoriler.kategori_id

    WHERE Islemler.kullanici_id = ?
    AND Islemler.tur = 'gider'
    AND MONTH(Islemler.tarih) = ?

    GROUP BY Islemler.kategori_id

    ORDER BY toplam DESC
    `;

    const hesapSql = `
    SELECT

    Hesaplar.hesap_adi,
    COUNT(*) AS adet

    FROM Islemler

    INNER JOIN Hesaplar

    ON Islemler.hesap_id = Hesaplar.hesap_id

    WHERE Islemler.kullanici_id = ?
    AND MONTH(Islemler.tarih) = ?

    GROUP BY Islemler.hesap_id
    `;


    db.query(

        gelirSql,

        [

            req.session.user.id,
            ay

        ],

        (err, gelirResult) => {

            if(err){

                console.log(err);

                return;

            }

            db.query(

                giderSql,

                [

                    req.session.user.id,
                    ay

                ],

                (err, giderResult) => {

                    if(err){

                        console.log(err);

                        return;

                    }

                    db.query(

                        kategoriSql,

                        [

                            req.session.user.id,
                            ay

                        ],

                        (err, kategoriResult) => {

                            if(err){

                                console.log(err);

                                return;

                            }

                            db.query(

                                hesapSql,

                                [

                                    req.session.user.id,
                                    ay

                                ],

                                (err, hesapResult) => {

                                    if(err){

                                        console.log(err);

                                        return;

                                    }

                                    const toplamGelir =
                                    gelirResult[0].toplamGelir || 0;

                                    const toplamGider =
                                    giderResult[0].toplamGider || 0;


                                    let tasarruf = 0;

                                    if(toplamGelir > 0){

                                        tasarruf =
                                        ((toplamGelir - toplamGider)
                                        / toplamGelir) * 100;

                                    }

                                    const kategoriAdlari =
                                    kategoriResult.map(

                                        x => x.kategori_adi

                                    );

                                    const kategoriToplamlari =
                                    kategoriResult.map(

                                        x => x.toplam

                                    );

                                    const hesapAdlari =
                                    hesapResult.map(

                                        x => x.hesap_adi

                                    );

                                    const hesapKullanimlari =
                                    hesapResult.map(

                                        x => x.adet

                                    );

                                    res.render("analizler", {

                                        ay,

                                        toplamGelir,

                                        toplamGider,

                                        tasarruf:
                                        tasarruf.toFixed(1),

                                        enCokKategori:
                                        kategoriResult[0]?.kategori_adi
                                        || "Veri yok",

                                        kategoriAdlari:
                                        JSON.stringify(kategoriAdlari),

                                        kategoriToplamlari:
                                        JSON.stringify(kategoriToplamlari),

                                        hesapAdlari:
                                        JSON.stringify(hesapAdlari),

                                        hesapKullanimlari:
                                        JSON.stringify(hesapKullanimlari)

                                    });

                                }

                            );

                        }

                    );

                }

            );

        }

    );

});


app.get("/islemler", (req, res) => {
    if (!req.session.user) return res.redirect("/");

    const { filtre, kategori, ay } = req.query;
    let params = [req.session.user.id];

    let sql = `
        SELECT Islemler.*, Kategoriler.ad AS kategori_adi, Hesaplar.hesap_adi AS hesap_adi
        FROM Islemler
        LEFT JOIN Kategoriler ON Islemler.kategori_id = Kategoriler.kategori_id
        LEFT JOIN Hesaplar ON Islemler.hesap_id = Hesaplar.hesap_id
        WHERE Islemler.kullanici_id = ?
    `;

    if (filtre === 'gelir' || filtre === 'gider') {
        sql += ` AND Islemler.tur = ?`;
        params.push(filtre);
    }
    
    if (kategori) {
        sql += ` AND Islemler.kategori_id = ?`;
        params.push(kategori);
    }

    if (ay && ay !== 'hepsi') {
        sql += ` AND MONTH(Islemler.tarih) = ?`;
        params.push(ay);
    }

    sql += ` ORDER BY Islemler.tarih DESC, Islemler.islem_id DESC`;

    db.query("SELECT * FROM Hesaplar WHERE kullanici_id = ?", [req.session.user.id], (errHesap, hesaplar) => {
        db.query("SELECT * FROM Kategoriler", (err, kategoriler) => {
            db.query(sql, params, (err, islemler) => {
                res.render("islemler", {
                    islemler: islemler,
                    kategoriler: kategoriler,
                    hesaplar: hesaplar, // <--- Bu eklendi!
                    user: req.session.user,
                    suankiFiltre: filtre || 'hepsi',
                    suankiKategori: kategori || '',
                    suankiAy: ay || 'hepsi'
                });
            });
        });
    });
});


app.get("/butce-sil/:id", (req, res) => {
    if (!req.session.user) return res.redirect("/");

    const id = req.params.id;
    const sql = "DELETE FROM Butceler WHERE butce_id = ? AND kullanici_id = ?";

    db.query(sql, [id, req.session.user.id], (err, result) => {
        if (err) {
            console.log(err);
            return;
        }
        res.redirect("/butceler");
    });
});


app.post("/butce-guncelle/:id", (req, res) => {
    if (!req.session.user) return res.redirect("/");

    const id = req.params.id;
    const { miktar } = req.body;
    const sql = "UPDATE Butceler SET miktar = ? WHERE butce_id = ? AND kullanici_id = ?";

    db.query(sql, [miktar, id, req.session.user.id], (err, result) => {
        if (err) {
            console.log(err);
            return;
        }
        res.redirect("/butceler");
    });
});


app.post("/kart-borcu-ode", (req, res) => {
    if (!req.session.user) return res.redirect("/");

    const { kaynak_hesap_id, tutar } = req.body;
    const kullaniciId = req.session.user.id; 

   const sqlKaynakKontrol = "SELECT bakiye, hesap_adi FROM Hesaplar WHERE hesap_id = ? AND kullanici_id = ?";
    
    db.query(sqlKaynakKontrol, [kaynak_hesap_id, kullaniciId], (errKaynak, kaynakSonuc) => {
        if (errKaynak || kaynakSonuc.length === 0) return res.redirect("/dashboard");

        const mevcutKaynakBakiye = parseFloat(kaynakSonuc[0].bakiye || 0);
        const kaynakHesapAdi = kaynakSonuc[0].hesap_adi;

        if (kaynakHesapAdi.includes("Nakit")) {
            const hataMesaji = "HATA: Kredi kartı borcu nakit hesapla ödenemez! Lütfen bir Banka Hesabı seçin.";
            return res.redirect("/dashboard?error=" + encodeURIComponent(hataMesaji));
        }

        
        if (mevcutKaynakBakiye < parseFloat(tutar)) {
            const hataMesaji = "HATA: Seçilen banka hesabında yetersiz bakiye!";
            return res.redirect("/dashboard?error=" + encodeURIComponent(hataMesaji));
        }

        
        const sqlKartBul = "SELECT hesap_id FROM Hesaplar WHERE kullanici_id = ? AND hesap_adi LIKE '%Kredi Kartı%' LIMIT 1";

        db.query(sqlKartBul, [kullaniciId], (errKart, kartSonuc) => {
            if (errKart || kartSonuc.length === 0) return res.redirect("/dashboard");

            const hedefKartId = kartSonuc[0].hesap_id;

            
            const sqlBankadanDus = "UPDATE Hesaplar SET bakiye = bakiye - ? WHERE hesap_id = ? AND kullanici_id = ?";
            db.query(sqlBankadanDus, [tutar, kaynak_hesap_id, kullaniciId], (err1) => {
                if (err1) return res.redirect("/dashboard");

                
                const sqlKartaEkle = "UPDATE Hesaplar SET bakiye = bakiye + ? WHERE hesap_id = ? AND kullanici_id = ?";
                db.query(sqlKartaEkle, [tutar, hedefKartId, kullaniciId], (err2) => {
                    if (err2) return res.redirect("/dashboard");

                    
                    const sqlLog = "INSERT INTO Islemler (kullanici_id, hesap_id, kategori_id, tutar, tur, tarih, aciklama) VALUES (?, ?, 15, ?, 'gider', NOW(), 'Kredi Kartı Ekstre Ödemesi (Banka)')";
                    db.query(sqlLog, [kullaniciId, kaynak_hesap_id, tutar], (err3) => {
                        if (err3) console.log(err3);
                        res.redirect("/dashboard");
                    });
                });
            });
        });
    });
});