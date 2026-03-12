
let authData = null;

document.getElementById("load").onclick = async () => {
  const npsso = document.getElementById("npsso").value;

  const resp = await fetch("/api/login", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({npsso})
  });

  const data = await resp.json();

  if(!data.ok){
    alert(data.error);
    return;
  }

  authData = data.authorization;

  document.getElementById("profile").textContent =
    JSON.stringify(data.profile, null, 2);

  const games = document.getElementById("games");
  games.innerHTML="";

  data.titles.forEach(t=>{
    const btn=document.createElement("button");
    btn.innerText=t.trophyTitleName;

    btn.onclick=()=>loadGame(t);

    games.appendChild(btn);
    games.appendChild(document.createElement("br"));
  });
};

async function loadGame(title){

  const resp = await fetch("/api/title",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body: JSON.stringify({
      authorization: authData,
      npCommunicationId: title.npCommunicationId,
      platform: title.trophyTitlePlatform
    })
  });

  const data = await resp.json();

  const games = document.getElementById("games");

  const list = document.createElement("div");

  list.innerHTML = "<h3>Trophies</h3>";

  data.trophies.forEach(t => {

    const earned = data.earned.find(e => e.trophyId === t.trophyId);

    const row = document.createElement("div");

    row.style.padding = "6px";

    row.innerHTML =
      (earned ? "✅ " : "⬜ ") +
      "<b>" + t.trophyName + "</b>" +
      " (" + t.trophyType + ")";

    list.appendChild(row);

  });

  games.appendChild(list);
}
